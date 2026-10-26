import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type AppDatabase, type DbExecutor } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { behaviorHistory, behaviorPoints } from '../../db/schema';
import { StatsService } from '../users/stats.service';

export type BehaviorChange = {
  points?: number;
  satisfaction?: number;
};

export type BehaviorEvent =
  | 'RATING_RECEIVED'
  | 'RATING_REVOKED'
  | 'ORDER_REJECTED'
  | 'ORDER_EXPIRED'
  | 'ORDER_EARLY_END'
  | 'REPORT_APPROVED'
  | 'MANUAL_ADJUSTMENT';

/**
 * Rating impacts, expressed as deltas. The original implementation mixed
 * absolute assignments with subtractions and could drive the counters negative.
 */
export const RATING_EFFECTS: Record<number, BehaviorChange> = {
  5: { points: 2, satisfaction: 4 },
  4: { points: 1, satisfaction: 2 },
  3: {},
  2: { points: -3, satisfaction: -6 },
  1: { points: -5, satisfaction: -10 },
};

const clamp = (value: number): number => Math.min(100, Math.max(0, value));

@Injectable()
export class BehaviorService {
  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly stats: StatsService,
  ) {}

  async get(userId: string): Promise<{ points: number; satisfaction: number }> {
    const [row] = await this.db
      .select({ points: behaviorPoints.points, satisfaction: behaviorPoints.satisfaction })
      .from(behaviorPoints)
      .where(eq(behaviorPoints.userId, userId))
      .limit(1);

    return { points: row?.points ?? 100, satisfaction: row?.satisfaction ?? 100 };
  }

  async applyRating(
    executor: DbExecutor,
    userId: string,
    rate: number,
    ratingId: string,
  ): Promise<void> {
    const effect = RATING_EFFECTS[rate];
    if (!effect) {
      throw AppError.badRequest(ErrorCode.validationFailed, 'rate must be between 1 and 5');
    }

    if (effect.points === undefined && effect.satisfaction === undefined) return;

    await this.adjust(executor, userId, 'RATING_RECEIVED', effect, ratingId);
    await this.stats.recompute(userId, executor);
  }

  async adjust(
    executor: DbExecutor,
    userId: string,
    event: BehaviorEvent,
    change: BehaviorChange,
    referenceId?: string,
    note?: string,
  ): Promise<{ points: number; satisfaction: number }> {
    const [current] = await executor
      .select()
      .from(behaviorPoints)
      .where(eq(behaviorPoints.userId, userId))
      .limit(1);

    if (!current) {
      await executor
        .insert(behaviorPoints)
        .values({ userId })
        .onConflictDoNothing();
    }

    const base = current ?? { points: 100, satisfaction: 100 };
    const nextPoints = change.points === undefined ? base.points : clamp(base.points + change.points);
    const nextSatisfaction =
      change.satisfaction === undefined ? base.satisfaction : clamp(base.satisfaction + change.satisfaction);

    if (nextPoints === base.points && nextSatisfaction === base.satisfaction) {
      return { points: base.points, satisfaction: base.satisfaction };
    }

    await executor
      .update(behaviorPoints)
      .set({ points: nextPoints, satisfaction: nextSatisfaction, updatedAt: new Date() })
      .where(eq(behaviorPoints.userId, userId));

    const historyRows: Array<typeof behaviorHistory.$inferInsert> = [];
    const actualPoints = nextPoints - base.points;
    const actualSatisfaction = nextSatisfaction - base.satisfaction;

    if (actualPoints !== 0) {
      historyRows.push({
        userId,
        event,
        operation: actualPoints > 0 ? 'ADD' : 'SUB',
        pointType: 'POINTS',
        amount: Math.abs(actualPoints),
        referenceId,
        note,
      });
    }
    if (actualSatisfaction !== 0) {
      historyRows.push({
        userId,
        event,
        operation: actualSatisfaction > 0 ? 'ADD' : 'SUB',
        pointType: 'SATISFACTION',
        amount: Math.abs(actualSatisfaction),
        referenceId,
        note,
      });
    }

    if (historyRows.length > 0) {
      await executor.insert(behaviorHistory).values(historyRows);
    }

    return { points: nextPoints, satisfaction: nextSatisfaction };
  }
}
