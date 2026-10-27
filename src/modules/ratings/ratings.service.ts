import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DB, type AppDatabase, type DbExecutor } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { offsetOf, paginated, type Paginated } from '../../common/pagination/pagination';
import { addHours, Clock } from '../../common/time/time';
import { CONFIG_KEYS } from '../../db/schema';
import { orders, ratings, reports, users, type Rating } from '../../db/schema';
import { BehaviorService, RATING_EFFECTS, type BehaviorChange } from '../behavior/behavior.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { StatsService } from '../users/stats.service';
import type {
  ListFlaggedRatingsQuery,
  ListRatingsQuery,
  RatingAuthor,
  RatingDto,
  RatingSummaryDto,
  ResolveViolationDto,
} from './ratings.dto';

const RATEABLE_STATUSES = ['COMPLETED', 'ENDED_EARLY_BY_HIRER', 'ENDED_EARLY_BY_PLAYER'] as const;

const raterTable = alias(users, 'rater');
const rateeTable = alias(users, 'ratee');

const authorOf = (row: { id: string; name: string; avatarUrl: string | null } | null): RatingAuthor | null =>
  row ? { id: row.id, name: row.name, avatarUrl: row.avatarUrl } : null;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
}

@Injectable()
export class RatingsService {
  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly clock: Clock,
    private readonly configs: SystemConfigService,
    private readonly behavior: BehaviorService,
    private readonly stats: StatsService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(raterId: string, orderId: string, rate: number, comment?: string): Promise<RatingDto> {
    const [order] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) throw AppError.notFound(ErrorCode.orderNotFound, 'Order not found');

    const isHirer = order.hirerId === raterId;
    const isPlayer = order.playerId === raterId;
    if (!isHirer && !isPlayer) {
      throw AppError.forbidden(ErrorCode.orderNotParticipant, 'Only the hirer or the player can rate this order');
    }

    if (!RATEABLE_STATUSES.includes(order.status as (typeof RATEABLE_STATUSES)[number])) {
      throw AppError.conflict(ErrorCode.invalidOrderState, 'Only finished orders can be rated');
    }

    const endedAt = order.endedAt ?? order.scheduledEndAt;
    if (!endedAt) throw AppError.conflict(ErrorCode.invalidOrderState, 'Order has no completion timestamp');

    const windowHours = await this.configs.getNumber(CONFIG_KEYS.feedbackWindowHours);
    if (this.clock.now().getTime() > addHours(endedAt, windowHours).getTime()) {
      throw AppError.conflict(
        ErrorCode.feedbackWindowClosed,
        `Ratings are only accepted within ${windowHours} hours of the order ending`,
      );
    }

    const [existingReport] = await this.db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.orderId, orderId), eq(reports.reporterId, raterId)))
      .limit(1);

    if (existingReport) {
      throw AppError.conflict(
        ErrorCode.conflict,
        'You already reported the other party on this order, so you cannot rate it',
      );
    }

    const [existingRating] = await this.db
      .select({ id: ratings.id })
      .from(ratings)
      .where(and(eq(ratings.orderId, orderId), eq(ratings.raterId, raterId)))
      .limit(1);

    if (existingRating) throw AppError.conflict(ErrorCode.alreadyRated, 'You already rated this order');

    const rateeId = isHirer ? order.playerId : order.hirerId;
    const [rater] = await this.db
      .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, raterId))
      .limit(1);
    const [ratee] = await this.db
      .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, rateeId))
      .limit(1);

    let created: Rating;
    try {
      created = await this.db.transaction(async (tx) => {
        const [rating] = await tx
          .insert(ratings)
          .values({ orderId, raterId, rateeId, rate, comment: comment ?? null })
          .returning();

        await this.behavior.applyRating(tx, rateeId, rate, rating.id);

        await this.notifications.send(tx, {
          userId: rateeId,
          title: `You received a ${rate}-star rating`,
          body: `${rater?.name ?? 'Another user'} rated your session: ${rate} stars${comment ? ` — ${comment}` : ''}`,
          referenceUrl: `/orders/${orderId}`,
        });

        return rating;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict(ErrorCode.alreadyRated, 'You already rated this order');
      throw error;
    }

    return this.map(created, rater ?? null, ratee ?? null);
  }

  async listForUser(userId: string, query: ListRatingsQuery): Promise<Paginated<RatingDto>> {
    const filters = [eq(ratings.rateeId, userId), eq(ratings.isActive, true)];
    if (query.rate !== undefined) filters.push(eq(ratings.rate, query.rate));
    const where = and(...filters);

    const orderBy =
      query.sort === 'highest'
        ? [desc(ratings.rate), desc(ratings.createdAt)]
        : query.sort === 'lowest'
          ? [asc(ratings.rate), desc(ratings.createdAt)]
          : [desc(ratings.createdAt)];

    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          rating: ratings,
          raterId: raterTable.id,
          raterName: raterTable.name,
          raterAvatar: raterTable.avatarUrl,
        })
        .from(ratings)
        .innerJoin(raterTable, eq(raterTable.id, ratings.raterId))
        .where(where)
        .orderBy(...orderBy)
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(ratings).where(where),
    ]);

    return paginated(
      rows.map((row) =>
        this.map(
          row.rating,
          { id: row.raterId, name: row.raterName, avatarUrl: row.raterAvatar },
          null,
        ),
      ),
      total?.value ?? 0,
      query.page,
      query.pageSize,
    );
  }

  async summary(userId: string): Promise<RatingSummaryDto> {
    const rows = await this.db
      .select({ rate: ratings.rate, value: count() })
      .from(ratings)
      .where(and(eq(ratings.rateeId, userId), eq(ratings.isActive, true)))
      .groupBy(ratings.rate);

    const distribution: RatingSummaryDto['distribution'] = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    let sum = 0;
    let total = 0;

    for (const row of rows) {
      const key = String(row.rate) as keyof RatingSummaryDto['distribution'];
      if (key in distribution) distribution[key] = Number(row.value);
      sum += row.rate * Number(row.value);
      total += Number(row.value);
    }

    return {
      userId,
      average: total === 0 ? 0 : Math.round((sum / total) * 100) / 100,
      count: total,
      distribution,
    };
  }

  async flag(userId: string, ratingId: string, reason: string): Promise<RatingDto> {
    const [rating] = await this.db.select().from(ratings).where(eq(ratings.id, ratingId)).limit(1);
    if (!rating) throw AppError.notFound(ErrorCode.ratingNotFound, 'Rating not found');
    if (rating.rateeId !== userId) {
      throw AppError.forbidden(ErrorCode.forbidden, 'Only the rated user can flag this rating');
    }
    if (rating.violationStatus !== 'NONE') {
      throw AppError.conflict(ErrorCode.violationNotAllowed, 'This rating has already been flagged or reviewed');
    }

    const [updated] = await this.db
      .update(ratings)
      .set({ violationStatus: 'FLAGGED', violationReason: reason })
      .where(eq(ratings.id, ratingId))
      .returning();

    const [rater] = await this.db
      .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, updated.raterId))
      .limit(1);
    const [ratee] = await this.db
      .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, updated.rateeId))
      .limit(1);

    return this.map(updated, rater ?? null, ratee ?? null);
  }

  async listFlagged(query: ListFlaggedRatingsQuery): Promise<Paginated<RatingDto>> {
    const where = eq(ratings.violationStatus, query.status);

    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          rating: ratings,
          raterId: raterTable.id,
          raterName: raterTable.name,
          raterAvatar: raterTable.avatarUrl,
          rateeId: rateeTable.id,
          rateeName: rateeTable.name,
          rateeAvatar: rateeTable.avatarUrl,
        })
        .from(ratings)
        .innerJoin(raterTable, eq(raterTable.id, ratings.raterId))
        .innerJoin(rateeTable, eq(rateeTable.id, ratings.rateeId))
        .where(where)
        .orderBy(desc(ratings.createdAt))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(ratings).where(where),
    ]);

    return paginated(
      rows.map((row) =>
        this.map(
          row.rating,
          { id: row.raterId, name: row.raterName, avatarUrl: row.raterAvatar },
          { id: row.rateeId, name: row.rateeName, avatarUrl: row.rateeAvatar },
        ),
      ),
      total?.value ?? 0,
      query.page,
      query.pageSize,
    );
  }

  async resolveViolation(adminId: string, ratingId: string, dto: ResolveViolationDto): Promise<RatingDto> {
    const resolved = await this.db.transaction(async (tx) => {
      const [rating] = await tx.select().from(ratings).where(eq(ratings.id, ratingId)).for('update');
      if (!rating) throw AppError.notFound(ErrorCode.ratingNotFound, 'Rating not found');
      if (rating.violationStatus !== 'FLAGGED') {
        throw AppError.conflict(ErrorCode.alreadyResolved, 'Only flagged ratings can be resolved');
      }

      const upheld = dto.decision === 'UPHELD';
      const [updated] = await tx
        .update(ratings)
        .set({
          isActive: upheld ? false : rating.isActive,
          violationStatus: dto.decision,
          violationReason: dto.note ? dto.note.slice(0, 500) : rating.violationReason,
          resolvedBy: adminId,
          resolvedAt: this.clock.now(),
        })
        .where(eq(ratings.id, ratingId))
        .returning();

      if (upheld) {
        const effect = RATING_EFFECTS[rating.rate];
        if (effect) {
          const inverse: BehaviorChange = {};
          if (effect.points !== undefined) inverse.points = -effect.points;
          if (effect.satisfaction !== undefined) inverse.satisfaction = -effect.satisfaction;
          await this.behavior.adjust(
            tx,
            rating.rateeId,
            'RATING_REVOKED',
            inverse,
            rating.id,
            dto.note ?? 'Rating revoked after review',
          );
        }
        await this.stats.recompute(rating.rateeId, tx);
      }

      await this.notifications.send(tx, {
        userId: rating.rateeId,
        title: upheld ? 'Flagged rating removed' : 'Flagged rating kept',
        body: upheld
          ? 'Your flag was upheld and the rating has been removed from your profile.'
          : 'Your flag was reviewed and the rating stays visible on your profile.',
        referenceUrl: '/users/me',
      });

      return updated;
    });

    return this.withAuthors(resolved, this.db);
  }

  private async withAuthors(rating: Rating, executor: DbExecutor): Promise<RatingDto> {
    const [rater] = await executor
      .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, rating.raterId))
      .limit(1);
    const [ratee] = await executor
      .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, rating.rateeId))
      .limit(1);

    return this.map(rating, rater ?? null, ratee ?? null);
  }

  async listForOrder(orderId: string, viewerId: string): Promise<RatingDto[]> {
    const [order] = await this.db
      .select({ hirerId: orders.hirerId, playerId: orders.playerId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) throw AppError.notFound(ErrorCode.orderNotFound, 'Order not found');
    if (order.hirerId !== viewerId && order.playerId !== viewerId) {
      throw AppError.forbidden(ErrorCode.orderNotParticipant, 'Only the hirer or the player can read these ratings');
    }

    const rows = await this.db
      .select({
        rating: ratings,
        raterId: raterTable.id,
        raterName: raterTable.name,
        raterAvatar: raterTable.avatarUrl,
        rateeId: rateeTable.id,
        rateeName: rateeTable.name,
        rateeAvatar: rateeTable.avatarUrl,
      })
      .from(ratings)
      .innerJoin(raterTable, eq(raterTable.id, ratings.raterId))
      .innerJoin(rateeTable, eq(rateeTable.id, ratings.rateeId))
      .where(eq(ratings.orderId, orderId))
      .orderBy(desc(ratings.createdAt));

    return rows.map((row) =>
      this.map(
        row.rating,
        { id: row.raterId, name: row.raterName, avatarUrl: row.raterAvatar },
        { id: row.rateeId, name: row.rateeName, avatarUrl: row.rateeAvatar },
      ),
    );
  }

  private map(
    rating: Rating,
    rater: { id: string; name: string; avatarUrl: string | null } | null,
    ratee: { id: string; name: string; avatarUrl: string | null } | null,
  ): RatingDto {
    return {
      id: rating.id,
      orderId: rating.orderId,
      raterId: rating.raterId,
      rateeId: rating.rateeId,
      rate: rating.rate,
      comment: rating.comment,
      isActive: rating.isActive,
      violationStatus: rating.violationStatus,
      violationReason: rating.violationReason,
      rater: authorOf(rater),
      ratee: authorOf(ratee),
      createdAt: rating.createdAt.toISOString(),
    };
  }
}
