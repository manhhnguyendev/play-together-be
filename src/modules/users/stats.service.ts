import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { DB, type AppDatabase, type DbExecutor } from '../../common/database/database.module';
import { rankingPointsOf } from '../../common/money/money';
import { Clock, periodStartsInZone } from '../../common/time/time';
import { behaviorPoints, FINISHED_ORDER_STATUSES, orders, ratings, users } from '../../db/schema';
import {
  summariseSessions,
  type FinishedSession,
  type SessionGranularity,
} from './session-stats';
import {
  MAX_SESSION_BUCKETS,
  SessionStatsQuery,
  type SessionStatsView,
} from './users.dto';

const DEFAULT_SESSION_BUCKETS = Math.min(14, MAX_SESSION_BUCKETS);

/** `endedAt` is nullable on the table but not on a session that has finished. */
type SessionRow = Omit<FinishedSession, 'endedAt'> & { endedAt: Date | null };
const hasEndedAt = (row: SessionRow): row is FinishedSession => row.endedAt !== null;

const COUNTED_STATUSES = sql`(${sql.join(
  FINISHED_ORDER_STATUSES.map((status) => sql`${status}`),
  sql`, `,
)})`;

export type RecomputedStats = {
  ratingSum: number;
  ratingCount: number;
  ordersCount: number;
  completedOrdersCount: number;
  totalHours: number;
  onTimeCount: number;
  rankingPoints: number;
};

/**
 * User statistics are always derived from the source tables instead of being
 * incremented in place. The original implementation drifted whenever an order
 * was cancelled, a rating was revoked or a process crashed mid-flight.
 */
@Injectable()
export class StatsService {
  private readonly timeZone: string;

  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly clock: Clock,
    config: ConfigService,
  ) {
    this.timeZone = config.get<string>('APP_TIMEZONE') ?? 'Asia/Ho_Chi_Minh';
  }

  async recompute(userId: string, executor: DbExecutor = this.db): Promise<RecomputedStats> {
    const [ratingAgg] = await executor
      .select({
        sum: sql<number>`coalesce(sum(${ratings.rate}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(ratings)
      .where(and(eq(ratings.rateeId, userId), eq(ratings.isActive, true)));

    const [orderAgg] = await executor
      .select({
        total: sql<number>`count(*)`,
        completed: sql<number>`count(*) filter (where ${orders.status} in ${COUNTED_STATUSES})`,
        onTime: sql<number>`count(*) filter (where ${orders.status} = 'SETTLED'
          and ${orders.scheduledEndAt} is not null
          and ${orders.endedAt} is not null
          and ${orders.endedAt} <= ${orders.scheduledEndAt})`,
        hours: sql<number>`coalesce(sum(${orders.hours}) filter (where ${orders.status} in ${COUNTED_STATUSES}), 0)`,
      })
      .from(orders)
      .where(eq(orders.playerId, userId));

    const [behavior] = await executor
      .select({ points: behaviorPoints.points })
      .from(behaviorPoints)
      .where(eq(behaviorPoints.userId, userId))
      .limit(1);

    const stats = {
      ratingSum: Number(ratingAgg?.sum ?? 0),
      ratingCount: Number(ratingAgg?.count ?? 0),
      ordersCount: Number(orderAgg?.total ?? 0),
      completedOrdersCount: Number(orderAgg?.completed ?? 0),
      totalHours: Number(orderAgg?.hours ?? 0),
      onTimeCount: Number(orderAgg?.onTime ?? 0),
    };

    const rankingPoints = rankingPointsOf({
      ratingSum: stats.ratingSum,
      ratingCount: stats.ratingCount,
      completedOrders: stats.completedOrdersCount,
      onTimeCount: stats.onTimeCount,
      behaviorPoints: behavior?.points ?? 100,
    });

    await executor
      .update(users)
      .set({ ...stats, rankingPoints, updatedAt: this.clock.now() })
      .where(eq(users.id, userId));

    return { ...stats, rankingPoints };
  }

  /**
   * Finished sessions per local day or month, read from both sides of the trade at
   * once: what the caller earned as a player and what they paid as a hirer.
   *
   * The bucketing happens in the app timezone in JavaScript rather than through a
   * Postgres timezone function, because the dev database is PGlite and production is
   * real Postgres — and the two make different promises about which timezone names
   * their ICU build knows. `summariseSessions` is pure, so the boundary maths that
   * decides which column a session lands in is testable without a database.
   */
  async sessionStats(userId: string, query: SessionStatsQuery): Promise<SessionStatsView> {
    const granularity: SessionGranularity = query.granularity ?? 'day';
    const count = query.buckets ?? DEFAULT_SESSION_BUCKETS;
    const starts = periodStartsInZone(this.clock.now(), this.timeZone, granularity, count);

    const rows = await this.db
      .select({
        endedAt: orders.endedAt,
        playerId: orders.playerId,
        hirerId: orders.hirerId,
        hours: orders.hours,
        totalPrice: orders.totalPrice,
        playerPayout: orders.playerPayout,
      })
      .from(orders)
      .where(
        and(
          or(eq(orders.playerId, userId), eq(orders.hirerId, userId)),
          inArray(orders.status, [...FINISHED_ORDER_STATUSES]),
          gte(orders.endedAt, starts[0]),
        ),
      );

    const buckets = summariseSessions(
      rows.filter(hasEndedAt),
      starts,
      this.timeZone,
      granularity,
      userId,
    );

    return {
      granularity,
      buckets: buckets.map((bucket) => ({
        bucket: bucket.bucket,
        startsAt: bucket.startsAt.toISOString(),
        playerSessions: bucket.playerSessions,
        playerHours: bucket.playerHours,
        earned: bucket.earned,
        hirerSessions: bucket.hirerSessions,
        spent: bucket.spent,
      })),
    };
  }
}
