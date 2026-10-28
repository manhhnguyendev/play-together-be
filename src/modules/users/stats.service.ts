import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DB, type AppDatabase, type DbExecutor } from '../../common/database/database.module';
import { rankingPointsOf } from '../../common/money/money';
import { Clock } from '../../common/time/time';
import { behaviorPoints, orders, ratings, users } from '../../db/schema';

const COUNTED_STATUSES = sql`('COMPLETED', 'ENDED_EARLY_BY_HIRER', 'ENDED_EARLY_BY_PLAYER')`;

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
  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly clock: Clock,
  ) {}

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
        onTime: sql<number>`count(*) filter (where ${orders.status} = 'COMPLETED'
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
}
