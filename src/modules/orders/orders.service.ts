import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, lte, or, type SQL } from 'drizzle-orm';
import { DB, type AppDatabase, type DbExecutor } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { quoteEarlyEnd } from '../../common/money/money';
import { offsetOf, paginated, type Paginated } from '../../common/pagination/pagination';
import { addHours, addMinutes, Clock, MS_HOUR } from '../../common/time/time';
import {
  escrowHolds,
  games,
  orderGames,
  orders,
  orderStatusHistory,
  ratings,
  userSkills,
  users,
  type Order,
  type OrderStatus,
  type User,
} from '../../db/schema';
import { BehaviorService } from '../behavior/behavior.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CONFIG_KEYS } from '../../db/schema/config';
import { SystemConfigService } from '../system-config/system-config.service';
import { StatsService } from '../users/stats.service';
import { toUserSummary } from '../users/user.mapper';
import { UsersService } from '../users/users.service';
import type { UserSummary } from '../users/users.dto';
import { WalletService } from '../wallet/wallet.service';
import type { CreateOrderDto, EndEarlyDto, ListOrdersQuery, RejectOrderDto } from './orders.dto';

const FINISHED_STATUSES = ['COMPLETED', 'ENDED_EARLY_BY_HIRER', 'ENDED_EARLY_BY_PLAYER'] as const;
const ACTIVE_STATUSES = ['PROCESSING', 'ACCEPTED'] as const;

export type OrderView = {
  id: string;
  status: OrderStatus;
  hours: number;
  hourlyRate: number;
  totalPrice: number;
  feeBps: number;
  playerPayout: number | null;
  message: string;
  reason: string | null;
  respondBy: string;
  startsAt: string | null;
  scheduledEndAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  hirer: UserSummary;
  player: UserSummary;
  games: Array<{ id: string; name: string; displayName: string | null }>;
  canRate: boolean;
  hasRated: boolean;
  escrowStatus: 'NONE' | 'HELD' | 'SETTLED' | 'REFUNDED' | 'PARTIALLY_SETTLED';
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly usersService: UsersService,
    private readonly stats: StatsService,
    private readonly behavior: BehaviorService,
    private readonly notifications: NotificationsService,
    private readonly wallet: WalletService,
    private readonly configs: SystemConfigService,
    private readonly clock: Clock,
  ) {}

  async create(hirerId: string, dto: CreateOrderDto): Promise<OrderView> {
    if (hirerId === dto.playerId) {
      throw AppError.badRequest(ErrorCode.selfHireNotAllowed, 'You cannot hire yourself');
    }
    if (await this.configs.isMaintenance()) {
      throw AppError.unavailable(ErrorCode.maintenanceMode, 'The system is under maintenance');
    }

    const hirer = await this.usersService.requireActive(hirerId);
    if (hirer.role !== 'USER') {
      throw AppError.forbidden(ErrorCode.forbidden, 'Only player accounts can hire');
    }
    if (hirer.isPlayer) {
      throw AppError.badRequest(
        ErrorCode.playerModeDisabled,
        'Turn off player mode before hiring another player',
      );
    }
    if (hirer.status !== 'ONLINE') {
      throw AppError.badRequest(
        ErrorCode.playerUnavailable,
        `Your presence is ${hirer.status}; set it to ONLINE before creating an order`,
      );
    }

    const player = await this.usersService.findById(dto.playerId);
    if (!player) throw AppError.notFound(ErrorCode.userNotFound, 'Player not found');
    if (!player.isActive) throw AppError.badRequest(ErrorCode.userNotActive, 'This player account is locked');
    if (!player.isPlayer) throw AppError.badRequest(ErrorCode.playerUnavailable, 'This user is not accepting hires');
    if (player.status !== 'ONLINE' && player.status !== 'OFFLINE') {
      throw AppError.badRequest(ErrorCode.playerUnavailable, `This player is currently ${player.status}`);
    }

    if (await this.usersService.isBlockedEitherWay(hirerId, player.id)) {
      throw AppError.forbidden(ErrorCode.messageBlocked, 'You cannot create an order with a blocked user');
    }

    if (dto.hours < 1 || dto.hours > player.maxHoursPerHire) {
      throw AppError.badRequest(
        ErrorCode.hoursOutOfRange,
        `This player accepts between 1 and ${player.maxHoursPerHire} hours per hire`,
      );
    }

    const gameIds = [...new Set(dto.gameIds)];
    if (gameIds.length !== dto.gameIds.length) {
      throw AppError.badRequest(ErrorCode.duplicateGames, 'Duplicate games are not allowed');
    }

    const skillRows = await this.db
      .select({ gameId: userSkills.gameId })
      .from(userSkills)
      .where(and(eq(userSkills.userId, player.id), inArray(userSkills.gameId, gameIds)));

    if (skillRows.length !== gameIds.length) {
      throw AppError.badRequest(
        ErrorCode.gameNotInPlayerSkills,
        'One or more selected games are not offered by this player',
      );
    }

    await this.assertNoActiveOrder(hirerId, player.id);

    const feeBps = await this.configs.getNumber(CONFIG_KEYS.platformFeeBps);
    const responseMinutes = await this.configs.getNumber(CONFIG_KEYS.orderResponseMinutes);
    const now = this.clock.now();
    const totalPrice = dto.hours * player.pricePerHour;

    let created: Order;
    try {
      created = await this.db.transaction(async (tx) => {
        const [order] = await tx
          .insert(orders)
          .values({
            hirerId,
            playerId: player.id,
            status: 'PROCESSING',
            hours: dto.hours,
            hourlyRate: player.pricePerHour,
            totalPrice,
            feeBps,
            message: dto.message,
            respondBy: addMinutes(now, responseMinutes),
          })
          .returning();

        await tx.insert(orderGames).values(gameIds.map((gameId) => ({ orderId: order.id, gameId })));
        await tx.insert(orderStatusHistory).values({
          orderId: order.id,
          fromStatus: null,
          toStatus: 'PROCESSING',
          actorId: hirerId,
          reason: 'Order created',
        });

        await this.notifications.send(tx, {
          userId: player.id,
          title: 'New hire request',
          body: `${hirer.name} wants to hire you for ${dto.hours} hour(s).`,
          referenceUrl: `/orders/${order.id}`,
        });

        return order;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppError.conflict(
          ErrorCode.activeOrderExists,
          'You or the player already have an active order; wait for it to finish',
        );
      }
      throw error;
    }

    const [view] = await this.hydrate([created], hirerId);
    return view;
  }

  async listMine(hirerId: string, query: ListOrdersQuery): Promise<Paginated<OrderView>> {
    return this.listOrders(eq(orders.hirerId, hirerId), hirerId, query);
  }

  async listRequests(playerId: string, query: ListOrdersQuery): Promise<Paginated<OrderView>> {
    return this.listOrders(eq(orders.playerId, playerId), playerId, query);
  }

  private async listOrders(
    owner: SQL,
    viewerId: string,
    query: ListOrdersQuery,
  ): Promise<Paginated<OrderView>> {
    const where = query.status ? and(owner, eq(orders.status, query.status)) : owner;

    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(orders)
        .where(where)
        .orderBy(desc(orders.createdAt))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(orders).where(where),
    ]);

    return paginated(await this.hydrate(rows, viewerId), total?.value ?? 0, query.page, query.pageSize);
  }

  async get(orderId: string, viewer: { id: string; role: string }): Promise<OrderView> {
    const order = await this.findOrder(orderId);
    if (viewer.role !== 'ADMIN' && order.hirerId !== viewer.id && order.playerId !== viewer.id) {
      throw AppError.forbidden(ErrorCode.orderNotParticipant, 'You are not a participant of this order');
    }

    const [view] = await this.hydrate([order], viewer.id);
    return view;
  }

  async history(orderId: string, viewer: { id: string; role: string }) {
    const order = await this.findOrder(orderId);
    if (viewer.role !== 'ADMIN' && order.hirerId !== viewer.id && order.playerId !== viewer.id) {
      throw AppError.forbidden(ErrorCode.orderNotParticipant, 'You are not a participant of this order');
    }

    return this.db
      .select({
        id: orderStatusHistory.id,
        fromStatus: orderStatusHistory.fromStatus,
        toStatus: orderStatusHistory.toStatus,
        reason: orderStatusHistory.reason,
        actorId: orderStatusHistory.actorId,
        createdAt: orderStatusHistory.createdAt,
      })
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(asc(orderStatusHistory.createdAt));
  }

  async accept(playerId: string, orderId: string): Promise<OrderView> {
    const now = this.clock.now();
    const existing = await this.findOrder(orderId);

    if (existing.playerId !== playerId) {
      throw AppError.forbidden(ErrorCode.orderNotParticipant, 'You are not the player of this order');
    }
    if (existing.status !== 'PROCESSING') {
      throw AppError.conflict(ErrorCode.invalidOrderState, `Order is ${existing.status}, not PROCESSING`);
    }
    if (existing.respondBy.getTime() <= now.getTime()) {
      await this.expireOrder(existing.id, now);
      throw AppError.conflict(ErrorCode.invalidOrderState, 'This hire request has expired');
    }

    const updated = await this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!order) throw AppError.notFound(ErrorCode.orderNotFound, 'Order not found');
      if (order.status !== 'PROCESSING') {
        throw AppError.conflict(ErrorCode.invalidOrderState, `Order is ${order.status}, not PROCESSING`);
      }
      if (order.respondBy.getTime() <= now.getTime()) {
        throw AppError.conflict(ErrorCode.invalidOrderState, 'This hire request has expired');
      }

      await this.wallet.holdEscrow(tx, {
        orderId: order.id,
        hirerId: order.hirerId,
        amount: order.totalPrice,
      });

      const startsAt = now;
      const scheduledEndAt = addHours(startsAt, order.hours);

      const [accepted] = await tx
        .update(orders)
        .set({ status: 'ACCEPTED', startsAt, scheduledEndAt, updatedAt: now })
        .where(eq(orders.id, order.id))
        .returning();

      await tx
        .update(users)
        .set({ status: 'BUSY', updatedAt: now })
        .where(eq(users.id, order.playerId));

      await tx.insert(orderStatusHistory).values({
        orderId: order.id,
        fromStatus: 'PROCESSING',
        toStatus: 'ACCEPTED',
        actorId: playerId,
        reason: `Session scheduled for ${order.hours} hour(s)`,
      });

      await this.notifications.send(tx, {
        userId: order.hirerId,
        title: 'Hire request accepted',
        body: `Your session starts now and runs for ${order.hours} hour(s).`,
        referenceUrl: `/orders/${order.id}`,
      });

      return accepted;
    });

    const [view] = await this.hydrate([updated], playerId);
    return view;
  }

  async reject(playerId: string, orderId: string, dto: RejectOrderDto): Promise<OrderView> {
    const now = this.clock.now();

    const updated = await this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!order) throw AppError.notFound(ErrorCode.orderNotFound, 'Order not found');
      if (order.playerId !== playerId) {
        throw AppError.forbidden(ErrorCode.orderNotParticipant, 'You are not the player of this order');
      }
      if (order.status !== 'PROCESSING') {
        throw AppError.conflict(ErrorCode.invalidOrderState, `Order is ${order.status}, not PROCESSING`);
      }

      const [rejected] = await tx
        .update(orders)
        .set({ status: 'REJECTED', reason: dto.reason ?? null, endedAt: now, updatedAt: now })
        .where(eq(orders.id, order.id))
        .returning();

      await tx.insert(orderStatusHistory).values({
        orderId: order.id,
        fromStatus: 'PROCESSING',
        toStatus: 'REJECTED',
        actorId: playerId,
        reason: dto.reason ?? null,
      });

      await this.behavior.adjust(tx, playerId, 'ORDER_REJECTED', { satisfaction: -1 }, order.id, 'Hire request rejected');

      await this.notifications.send(tx, {
        userId: order.hirerId,
        title: 'Hire request rejected',
        body: dto.reason ? `The player declined: ${dto.reason}` : 'The player declined your request.',
        referenceUrl: `/orders/${order.id}`,
      });

      return rejected;
    });

    const [view] = await this.hydrate([updated], playerId);
    return view;
  }

  async cancel(hirerId: string, orderId: string): Promise<OrderView> {
    const now = this.clock.now();

    const updated = await this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!order) throw AppError.notFound(ErrorCode.orderNotFound, 'Order not found');
      if (order.hirerId !== hirerId) {
        throw AppError.forbidden(ErrorCode.orderNotParticipant, 'You are not the hirer of this order');
      }
      if (order.status !== 'PROCESSING') {
        throw AppError.conflict(
          ErrorCode.invalidOrderState,
          'Only a pending request can be cancelled; use early-end for an accepted session',
        );
      }

      const [cancelled] = await tx
        .update(orders)
        .set({ status: 'CANCELLED', endedAt: now, updatedAt: now })
        .where(eq(orders.id, order.id))
        .returning();

      await tx.insert(orderStatusHistory).values({
        orderId: order.id,
        fromStatus: 'PROCESSING',
        toStatus: 'CANCELLED',
        actorId: hirerId,
        reason: 'Cancelled by hirer',
      });

      await this.notifications.send(tx, {
        userId: order.playerId,
        title: 'Hire request cancelled',
        body: 'The hirer cancelled their request.',
        referenceUrl: `/orders/${order.id}`,
      });

      return cancelled;
    });

    const [view] = await this.hydrate([updated], hirerId);
    return view;
  }

  async complete(actorId: string, orderId: string): Promise<OrderView> {
    const now = this.clock.now();

    const updated = await this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!order) throw AppError.notFound(ErrorCode.orderNotFound, 'Order not found');
      if (order.hirerId !== actorId && order.playerId !== actorId) {
        throw AppError.forbidden(ErrorCode.orderNotParticipant, 'You are not a participant of this order');
      }
      if (order.status !== 'ACCEPTED') {
        throw AppError.conflict(ErrorCode.invalidOrderState, `Order is ${order.status}, not ACCEPTED`);
      }
      if (order.scheduledEndAt && order.scheduledEndAt.getTime() > now.getTime()) {
        throw AppError.badRequest(
          ErrorCode.orderNotFinished,
          'This session has not reached its scheduled end yet; use early-end to stop it now',
        );
      }

      return this.settleCompletion(tx, order, now, actorId);
    });

    const [view] = await this.hydrate([updated], actorId);
    return view;
  }

  async endEarly(actorId: string, orderId: string, dto: EndEarlyDto): Promise<OrderView> {
    const now = this.clock.now();

    const updated = await this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!order) throw AppError.notFound(ErrorCode.orderNotFound, 'Order not found');
      if (order.hirerId !== actorId && order.playerId !== actorId) {
        throw AppError.forbidden(ErrorCode.orderNotParticipant, 'You are not a participant of this order');
      }
      if (order.status !== 'ACCEPTED' || !order.startsAt) {
        throw AppError.conflict(ErrorCode.invalidOrderState, `Order is ${order.status}, not ACCEPTED`);
      }

      const elapsedMs = Math.max(0, now.getTime() - order.startsAt.getTime());
      const totalMs = order.hours * MS_HOUR;
      const quote = quoteEarlyEnd(order.totalPrice, elapsedMs, totalMs);

      if (!quote.eligible) {
        throw AppError.badRequest(
          ErrorCode.earlyEndTooSoon,
          'Less than 10% of the booked time has elapsed; the session cannot be ended yet',
        );
      }

      const releaseHours = await this.configs.getNumber(CONFIG_KEYS.pendingReleaseHours);
      const settlement = await this.wallet.settleEscrow(tx, {
        orderId: order.id,
        hirerId: order.hirerId,
        playerId: order.playerId,
        earned: quote.earned,
        feeBps: order.feeBps,
        releaseHours,
      });

      const endedByHirer = order.hirerId === actorId;
      const status: OrderStatus = endedByHirer ? 'ENDED_EARLY_BY_HIRER' : 'ENDED_EARLY_BY_PLAYER';

      const [ended] = await tx
        .update(orders)
        .set({
          status,
          endedAt: now,
          reason: dto.reason ?? null,
          playerPayout: settlement.payout,
          updatedAt: now,
        })
        .where(eq(orders.id, order.id))
        .returning();

      await tx.insert(orderStatusHistory).values({
        orderId: order.id,
        fromStatus: 'ACCEPTED',
        toStatus: status,
        actorId,
        reason: dto.reason ?? `Ended early after ${quote.tenths}/10 of the session`,
      });

      await tx
        .update(users)
        .set({ status: 'ONLINE', updatedAt: now })
        .where(eq(users.id, order.playerId));

      await this.notifications.sendMany(tx, [
        {
          userId: order.hirerId,
          title: 'Session ended early',
          body: `The session ended early. ${quote.refund.toLocaleString('en-US')} VND was refunded to your wallet.`,
          referenceUrl: `/orders/${order.id}`,
        },
        {
          userId: order.playerId,
          title: 'Session ended early',
          body: `The session ended early. Your earnings are pending release.`,
          referenceUrl: `/orders/${order.id}`,
        },
      ]);

      await this.stats.recompute(order.playerId, tx);
      return ended;
    });

    const [view] = await this.hydrate([updated], actorId);
    return view;
  }

  /**
   * Force-stops every active order a user participates in, refunding any funds
   * held in escrow. Used when a moderator locks an account.
   */
  async interruptActiveForUser(
    tx: DbExecutor,
    userId: string,
    reason: string,
    actorId: string | null,
    now: Date = this.clock.now(),
  ): Promise<number> {
    const active = await tx
      .select()
      .from(orders)
      .where(
        and(
          or(eq(orders.hirerId, userId), eq(orders.playerId, userId)),
          inArray(orders.status, [...ACTIVE_STATUSES]),
        ),
      )
      .for('update');

    for (const order of active) {
      if (order.status === 'ACCEPTED') {
        await this.wallet.refundEscrow(tx, { orderId: order.id, hirerId: order.hirerId });
        await tx
          .update(users)
          .set({ status: 'ONLINE', updatedAt: now })
          .where(eq(users.id, order.playerId));
      }

      await tx
        .update(orders)
        .set({ status: 'INTERRUPTED', endedAt: now, reason: reason.slice(0, 500), updatedAt: now })
        .where(eq(orders.id, order.id));

      await tx.insert(orderStatusHistory).values({
        orderId: order.id,
        fromStatus: order.status,
        toStatus: 'INTERRUPTED',
        actorId,
        reason,
      });

      const counterpartId = order.hirerId === userId ? order.playerId : order.hirerId;
      await this.notifications.send(tx, {
        userId: counterpartId,
        title: 'Order interrupted',
        body: `This order was interrupted: ${reason}. Any escrowed funds were refunded to the hirer.`,
        referenceUrl: `/orders/${order.id}`,
      });
    }

    return active.length;
  }

  async expireDue(): Promise<number> {
    const now = this.clock.now();
    const due = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.status, 'PROCESSING'), lte(orders.respondBy, now)))
      .limit(200);

    let expired = 0;
    for (const row of due) {
      try {
        await this.expireOrder(row.id, now);
        expired += 1;
      } catch (error) {
        this.logger.warn(`Failed to expire order ${row.id}: ${(error as Error).message}`);
      }
    }
    return expired;
  }

  async autoCompleteDue(): Promise<number> {
    const now = this.clock.now();
    const due = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.status, 'ACCEPTED'), lte(orders.scheduledEndAt, now)))
      .limit(100);

    let completed = 0;
    for (const row of due) {
      try {
        await this.db.transaction(async (tx) => {
          const [order] = await tx.select().from(orders).where(eq(orders.id, row.id)).for('update');
          if (!order || order.status !== 'ACCEPTED') return;
          await this.settleCompletion(tx, order, now, null);
        });
        completed += 1;
      } catch (error) {
        this.logger.warn(`Failed to auto-complete order ${row.id}: ${(error as Error).message}`);
      }
    }
    return completed;
  }

  private async settleCompletion(
    tx: DbExecutor,
    order: Order,
    now: Date,
    actorId: string | null,
  ): Promise<Order> {
    const releaseHours = await this.configs.getNumber(CONFIG_KEYS.pendingReleaseHours);
    const settlement = await this.wallet.settleEscrow(tx, {
      orderId: order.id,
      hirerId: order.hirerId,
      playerId: order.playerId,
      earned: order.totalPrice,
      feeBps: order.feeBps,
      releaseHours,
    });

    const [completed] = await tx
      .update(orders)
      .set({
        status: 'COMPLETED',
        endedAt: order.scheduledEndAt ?? now,
        playerPayout: settlement.payout,
        updatedAt: now,
      })
      .where(eq(orders.id, order.id))
      .returning();

    await tx.insert(orderStatusHistory).values({
      orderId: order.id,
      fromStatus: 'ACCEPTED',
      toStatus: 'COMPLETED',
      actorId,
      reason: actorId ? 'Completed by participant' : 'Completed automatically after the scheduled end',
    });

    await tx
      .update(users)
      .set({ status: 'ONLINE', updatedAt: now })
      .where(eq(users.id, order.playerId));

    await this.notifications.sendMany(tx, [
      {
        userId: order.hirerId,
        title: 'Session completed',
        body: 'Your session is complete. Leave a rating to help the community.',
        referenceUrl: `/orders/${order.id}`,
      },
      {
        userId: order.playerId,
        title: 'Session completed',
        body: `Your earnings are pending and will become available shortly.`,
        referenceUrl: `/orders/${order.id}`,
      },
    ]);

    await this.stats.recompute(order.playerId, tx);
    return completed;
  }

  private async expireOrder(orderId: string, now: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!order || order.status !== 'PROCESSING') return;

      await tx
        .update(orders)
        .set({ status: 'EXPIRED', endedAt: now, updatedAt: now })
        .where(eq(orders.id, order.id));

      await tx.insert(orderStatusHistory).values({
        orderId: order.id,
        fromStatus: 'PROCESSING',
        toStatus: 'EXPIRED',
        actorId: null,
        reason: 'The player did not respond before the deadline',
      });

      await this.behavior.adjust(
        tx,
        order.playerId,
        'ORDER_EXPIRED',
        { points: -1, satisfaction: -2 },
        order.id,
        'Missed hire request',
      );

      await tx
        .update(users)
        .set({ isPlayer: false, status: 'ONLINE', updatedAt: now })
        .where(eq(users.id, order.playerId));

      await this.notifications.sendMany(tx, [
        {
          userId: order.playerId,
          title: 'Hire request expired',
          body: 'You missed a hire request, so player mode was switched off. Turn it back on when you are ready.',
          referenceUrl: `/orders/${order.id}`,
        },
        {
          userId: order.hirerId,
          title: 'Hire request expired',
          body: 'The player did not respond in time. No funds were taken.',
          referenceUrl: `/orders/${order.id}`,
        },
      ]);
    });
  }

  private async assertNoActiveOrder(hirerId: string, playerId: string): Promise<void> {
    const [active] = await this.db
      .select({ id: orders.id, hirerId: orders.hirerId })
      .from(orders)
      .where(
        and(
          or(eq(orders.hirerId, hirerId), eq(orders.playerId, playerId)),
          inArray(orders.status, [...ACTIVE_STATUSES]),
        ),
      )
      .limit(1);

    if (active) {
      throw AppError.conflict(
        ErrorCode.activeOrderExists,
        active.hirerId === hirerId
          ? 'You already have an active order'
          : 'This player is already handling another order',
      );
    }
  }

  private async findOrder(orderId: string): Promise<Order> {
    const [order] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) throw AppError.notFound(ErrorCode.orderNotFound, 'Order not found');
    return order;
  }

  private async hydrate(rows: Order[], viewerId: string): Promise<OrderView[]> {
    if (rows.length === 0) return [];

    const userIds = [...new Set(rows.flatMap((row) => [row.hirerId, row.playerId]))];
    const orderIds = rows.map((row) => row.id);

    const [userRows, gameRows, ratedRows, feedbackHours, holdRows] = await Promise.all([
      this.db.select().from(users).where(inArray(users.id, userIds)),
      this.db
        .select({
          orderId: orderGames.orderId,
          id: games.id,
          name: games.name,
          displayName: games.displayName,
        })
        .from(orderGames)
        .innerJoin(games, eq(games.id, orderGames.gameId))
        .where(inArray(orderGames.orderId, orderIds))
        .orderBy(asc(games.name)),
      this.db
        .select({ orderId: ratings.orderId })
        .from(ratings)
        .where(and(inArray(ratings.orderId, orderIds), eq(ratings.raterId, viewerId))),
      this.configs.getNumber(CONFIG_KEYS.feedbackWindowHours),
      this.db
        .select({ orderId: escrowHolds.orderId, status: escrowHolds.status })
        .from(escrowHolds)
        .where(inArray(escrowHolds.orderId, orderIds)),
    ]);

    const userMap = new Map<string, User>(userRows.map((row) => [row.id, row]));
    const gameMap = new Map<string, Array<{ id: string; name: string; displayName: string | null }>>();
    for (const row of gameRows) {
      const list = gameMap.get(row.orderId) ?? [];
      list.push({ id: row.id, name: row.name, displayName: row.displayName });
      gameMap.set(row.orderId, list);
    }
    const ratedSet = new Set(ratedRows.map((row) => row.orderId));
    const holdMap = new Map(holdRows.map((row) => [row.orderId, row.status]));

    const now = this.clock.now();

    return rows.map((order) => {
      const hirer = userMap.get(order.hirerId);
      const player = userMap.get(order.playerId);
      if (!hirer || !player) {
        throw AppError.notFound(ErrorCode.userNotFound, 'Order participant no longer exists');
      }

      const isParticipant = order.hirerId === viewerId || order.playerId === viewerId;
      const withinWindow =
        order.endedAt !== null &&
        now.getTime() <= order.endedAt.getTime() + feedbackHours * MS_HOUR;

      return {
        id: order.id,
        status: order.status,
        hours: order.hours,
        hourlyRate: order.hourlyRate,
        totalPrice: order.totalPrice,
        feeBps: order.feeBps,
        playerPayout: order.playerPayout,
        message: order.message,
        reason: order.reason,
        respondBy: order.respondBy.toISOString(),
        startsAt: order.startsAt?.toISOString() ?? null,
        scheduledEndAt: order.scheduledEndAt?.toISOString() ?? null,
        endedAt: order.endedAt?.toISOString() ?? null,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        hirer: toUserSummary(hirer, { includeEmail: isParticipant }),
        player: toUserSummary(player, { includeEmail: isParticipant }),
        games: gameMap.get(order.id) ?? [],
        canRate:
          isParticipant &&
          (FINISHED_STATUSES as readonly string[]).includes(order.status) &&
          withinWindow &&
          !ratedSet.has(order.id),
        hasRated: ratedSet.has(order.id),
        escrowStatus: (holdMap.get(order.id) ?? 'NONE') as OrderView['escrowStatus'],
      };
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}
