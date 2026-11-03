import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, count, desc, eq, gt, inArray, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { DB, type AppDatabase, type DbExecutor } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { isUniqueViolation } from '../../common/errors/pg-errors';
import { quoteEarlyEnd, formatVnd } from '../../common/money/money';
import { offsetOf, paginated, type Paginated } from '../../common/pagination/pagination';
import {
  addHours,
  addMinutes,
  Clock,
  formatDateTimeInZone,
  isSlotCovered,
  MS_DAY,
  MS_HOUR,
  MS_MINUTE,
} from '../../common/time/time';
import {
  availabilityWindows,
  escrowHolds,
  DISPUTED_ORDER_STATUSES,
  games,
  orderGames,
  orders,
  orderStatusHistory,
  PROPOSED_ORDER_STATUSES,
  ratings,
  reports,
  SCHEDULED_ORDER_STATUSES,
  SESSION_ORDER_STATUSES,
  userSkills,
  users,
  type Order,
  type OrderStatus,
  type User,
} from '../../db/schema';
import { BehaviorService } from '../behavior/behavior.service';
import { NotificationsService } from '../notifications/notifications.service';
import { canRateOrder } from '../ratings/rating-eligibility';
import { CONFIG_KEYS } from '../../db/schema/config';
import { SystemConfigService } from '../system-config/system-config.service';
import { StatsService } from '../users/stats.service';
import { toUserSummary } from '../users/user.mapper';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import type {
  CancelOrderDto,
  CreateOrderDto,
  EndEarlyDto,
  ListOrdersQuery,
  OrderView,
  RejectOrderDto,
} from './orders.dto';

export type { OrderView };

/** A party is committed to a session that has not been played out yet. */
const SESSION_STATUSES = SESSION_ORDER_STATUSES;
/** Anything that has not reached an outcome yet. */
const OPEN_STATUSES = ['PROPOSED', ...SESSION_ORDER_STATUSES, ...DISPUTED_ORDER_STATUSES] as const;
/** LIVE plus the reconciliation window that follows it. */
const SETTLEABLE_STATUSES = ['LIVE', 'DISPUTED'] as const;
/** Only a session that is still running can be stopped before its scheduled end. */
const LIVE_ONLY = ['LIVE'] as const;

/** Sessions cannot be booked further out than this — keeps calendars honest. */
const BOOKING_HORIZON_DAYS = 14;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly timeZone: string;

  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly usersService: UsersService,
    private readonly stats: StatsService,
    private readonly behavior: BehaviorService,
    private readonly notifications: NotificationsService,
    private readonly wallet: WalletService,
    private readonly configs: SystemConfigService,
    private readonly clock: Clock,
    config: ConfigService,
  ) {
    this.timeZone = config.get<string>('APP_TIMEZONE') ?? 'Asia/Ho_Chi_Minh';
  }

  async create(hirerId: string, dto: CreateOrderDto): Promise<OrderView> {
    if (hirerId === dto.playerId) {
      throw AppError.badRequest(ErrorCode.selfHireNotAllowed, 'You cannot hire yourself');
    }
    if (await this.configs.isMaintenance()) {
      throw AppError.unavailable(ErrorCode.maintenanceMode, 'The system is under maintenance');
    }

    const requestedStart = this.parseRequestedStart(dto.startsAt);
    const hireNow = requestedStart === null;

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
    if (hireNow ? hirer.status !== 'ONLINE' : hirer.status === 'MAINTAIN') {
      throw AppError.badRequest(
        ErrorCode.playerUnavailable,
        hireNow
          ? `Your presence is ${hirer.status}; set it to ONLINE before creating an order`
          : `Your account is ${hirer.status}; it cannot book sessions`,
      );
    }

    const player = await this.usersService.findById(dto.playerId);
    if (!player) throw AppError.notFound(ErrorCode.userNotFound, 'Player not found');
    if (!player.isActive) throw AppError.badRequest(ErrorCode.userNotActive, 'This player account is locked');
    if (!player.isPlayer) throw AppError.badRequest(ErrorCode.playerUnavailable, 'This user is not accepting hires');
    // Booking ahead and hiring now need different presence. Being busy in a
    // session today must not stop someone from taking next Tuesday — that is
    // the whole point of a calendar — but an instant hire still needs a player
    // who is not already mid-session.
    if (hireNow ? player.status !== 'ONLINE' && player.status !== 'OFFLINE' : player.status === 'MAINTAIN') {
      throw AppError.badRequest(
        ErrorCode.playerUnavailable,
        hireNow ? `This player is currently ${player.status}` : `This player is ${player.status}`,
      );
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

    const feeBps = await this.configs.getNumber(CONFIG_KEYS.platformFeeBps);
    const responseMinutes = await this.configs.getNumber(CONFIG_KEYS.orderResponseMinutes);
    const now = this.clock.now();
    const totalPrice = dto.hours * player.pricePerHour;

    let created: Order;
    try {
      created = await this.db.transaction(async (tx) => {
        // The slot is only reserved once the player accepts, so two hirers can
        // both put a request on the same free slot. Calendar locks keep the
        // availability + overlap check below and the accept that lands on the
        // same slot from deciding against each other's stale reads.
        await this.lockCalendars(tx, [hirerId, player.id]);

        const slot = requestedStart
          ? await this.resolveBookedSlot(tx, {
              playerId: player.id,
              hours: dto.hours,
              requestedStart,
              now,
            })
          : { startsAt: null, scheduledEndAt: null };

        if (slot.startsAt && slot.scheduledEndAt) {
          await this.assertSlotFree(tx, {
            hirerId,
            playerId: player.id,
            startsAt: slot.startsAt,
            scheduledEndAt: slot.scheduledEndAt,
          });
        }

        const [order] = await tx
          .insert(orders)
          .values({
            hirerId,
            playerId: player.id,
            status: 'PROPOSED',
            hours: dto.hours,
            hourlyRate: player.pricePerHour,
            totalPrice,
            feeBps,
            message: dto.message,
            respondBy: addMinutes(now, responseMinutes),
            startsAt: slot.startsAt,
            scheduledEndAt: slot.scheduledEndAt,
          })
          .returning();

        await tx.insert(orderGames).values(gameIds.map((gameId) => ({ orderId: order.id, gameId })));
        await tx.insert(orderStatusHistory).values({
          orderId: order.id,
          fromStatus: null,
          toStatus: 'PROPOSED',
          actorId: hirerId,
          reason: 'Tạo yêu cầu thuê',
        });

        await this.notifications.send(tx, {
          userId: player.id,
          title: 'Yêu cầu thuê mới',
          body: slot.startsAt
            ? `${hirer.name} muốn hẹn bạn ${dto.hours} giờ vào lúc ${formatDateTimeInZone(slot.startsAt, this.timeZone)}.`
            : `${hirer.name} muốn thuê bạn ${dto.hours} giờ.`,
          referenceUrl: `/orders/${order.id}`,
        });

        return order;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppError.conflict(
          ErrorCode.slotConflict,
          'That slot has just been taken. Pick another time or hire now instead.',
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
        .orderBy(desc(orders.createdAt), desc(orders.id))
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
    if (existing.status !== 'PROPOSED') {
      throw AppError.conflict(ErrorCode.invalidOrderState, `Order is ${existing.status}, not PROPOSED`);
    }
    if (existing.respondBy.getTime() <= now.getTime()) {
      await this.expireOrder(existing.id, now);
      throw AppError.conflict(ErrorCode.invalidOrderState, 'This hire request has expired');
    }

    const updated = await this.db.transaction(async (tx) => {
      const order = await this.lockOrder(tx, {
        orderId,
        actorId: playerId,
        role: 'player',
        expected: PROPOSED_ORDER_STATUSES,
      });
      if (order.respondBy.getTime() <= now.getTime()) {
        throw AppError.conflict(ErrorCode.invalidOrderState, 'This hire request has expired');
      }

      let status: OrderStatus = 'LIVE';
      let startsAt = now;
      let scheduledEndAt = addHours(now, order.hours);

      // Both paths take the same two calendar locks. An instant hire is a
      // session as well, and if its own span were never checked a player could
      // be hired live at 19:59 and find at 20:00 that they are also booked for a
      // session that can no longer start.
      await this.lockCalendars(tx, [order.hirerId, order.playerId]);

      if (order.startsAt && order.scheduledEndAt) {
        // A booked request is re-checked against the calendar as it is now, not
        // as it was when the request was sent: another hirer may have taken the
        // slot, or the player may have withdrawn those hours.
        const slot = await this.resolveBookedSlot(tx, {
          playerId: order.playerId,
          hours: order.hours,
          requestedStart: order.startsAt,
          now,
        });
        status = 'SCHEDULED';
        startsAt = slot.startsAt;
        scheduledEndAt = slot.scheduledEndAt;
      }

      await this.assertSlotFree(tx, {
        hirerId: order.hirerId,
        playerId: order.playerId,
        startsAt,
        scheduledEndAt,
        orderId: order.id,
      });

      await this.wallet.holdEscrow(tx, {
        orderId: order.id,
        hirerId: order.hirerId,
        amount: order.totalPrice,
      });

      const [accepted] = await tx
        .update(orders)
        .set({ status, startsAt, scheduledEndAt, updatedAt: now })
        .where(eq(orders.id, order.id))
        .returning();

      if (status === 'LIVE') {
        await tx
          .update(users)
          .set({ status: 'BUSY', updatedAt: now })
          .where(eq(users.id, order.playerId));
      }

      await tx.insert(orderStatusHistory).values({
        orderId: order.id,
        fromStatus: 'PROPOSED',
        toStatus: status,
        actorId: playerId,
        reason:
          status === 'SCHEDULED'
            ? `Đã hẹn lúc ${formatDateTimeInZone(startsAt, this.timeZone)} (${order.hours} giờ)`
            : `Bắt đầu ngay (${order.hours} giờ)`,
      });

      await this.notifications.send(tx, {
        userId: order.hirerId,
        title: status === 'SCHEDULED' ? 'Đã giữ lịch hẹn' : 'Đã chấp nhận yêu cầu thuê',
        body:
          status === 'SCHEDULED'
            ? `Lượt thuê của bạn bắt đầu lúc ${formatDateTimeInZone(startsAt, this.timeZone)}, kéo dài ${order.hours} giờ.`
            : `Lượt thuê bắt đầu ngay bây giờ, kéo dài ${order.hours} giờ.`,
        referenceUrl: `/orders/${order.id}`,
      });

      return accepted;
    });

    const [view] = await this.hydrate([updated], playerId);
    return view;
  }

  async reject(playerId: string, orderId: string, dto: RejectOrderDto): Promise<OrderView> {
    const now = this.clock.now();
    const existing = await this.findOrder(orderId);

    if (existing.playerId !== playerId) {
      throw AppError.forbidden(ErrorCode.orderNotParticipant, 'You are not the player of this order');
    }
    if (existing.status !== 'PROPOSED') {
      throw AppError.conflict(ErrorCode.invalidOrderState, `Order is ${existing.status}, not PROPOSED`);
    }
    // The app counts this window down and calls reject the moment it hits zero.
    // Recording that as a deliberate decline would apply the rejection penalty
    // to an expiry, so the deadline decides the outcome and the caller simply
    // sees the order close.
    if (existing.respondBy.getTime() <= now.getTime()) {
      await this.expireOrder(existing.id, now);
      const [view] = await this.hydrate([await this.findOrder(orderId)], playerId);
      return view;
    }

    const updated = await this.db.transaction(async (tx) => {
      const order = await this.lockOrder(tx, {
        orderId,
        actorId: playerId,
        role: 'player',
        expected: PROPOSED_ORDER_STATUSES,
      });

      const [rejected] = await tx
        .update(orders)
        .set({
          status: 'CLOSED',
          closeReason: 'REJECTED_BY_PLAYER',
          reason: dto.reason ?? null,
          endedAt: now,
          updatedAt: now,
        })
        .where(eq(orders.id, order.id))
        .returning();

      await tx.insert(orderStatusHistory).values({
        orderId: order.id,
        fromStatus: 'PROPOSED',
        toStatus: 'CLOSED',
        actorId: playerId,
        reason: dto.reason ?? null,
      });

      await this.behavior.adjust(tx, playerId, 'ORDER_REJECTED', { satisfaction: -1 }, order.id, 'Từ chối yêu cầu thuê');

      await this.notifications.send(tx, {
        userId: order.hirerId,
        title: 'Yêu cầu thuê bị từ chối',
        body: dto.reason ? `Người chơi đã từ chối: ${dto.reason}` : 'Người chơi đã từ chối yêu cầu của bạn.',
        referenceUrl: `/orders/${order.id}`,
      });

      return rejected;
    });

    const [view] = await this.hydrate([updated], playerId);
    return view;
  }

  async cancel(hirerId: string, orderId: string, dto: CancelOrderDto): Promise<OrderView> {
    const now = this.clock.now();
    const reason = dto.reason?.trim() ? dto.reason.trim().slice(0, 500) : null;

    const updated = await this.db.transaction(async (tx) => {
      const order = await this.lockOrder(tx, {
        orderId,
        actorId: hirerId,
        role: 'hirer',
        expected: [...PROPOSED_ORDER_STATUSES, ...SCHEDULED_ORDER_STATUSES],
        statusMessage:
          'Only a request or a session that has not started can be cancelled; use early-end once it is running',
      });
      if (order.status === 'SCHEDULED' && order.startsAt && order.startsAt.getTime() <= now.getTime()) {
        // The session has begun without the scheduler having flipped it yet.
        // Cancelling from here would refund a session that is already being
        // played, so it has to go through early-end like any running one.
        throw AppError.conflict(
          ErrorCode.invalidOrderState,
          'This session has already started; end it early instead',
        );
      }

      const booked = order.status === 'SCHEDULED';
      if (booked) {
        // Accepting a booking already moved the hirer's money into escrow, so
        // cancelling before the start has to move it back in full. Nothing is
        // charged to the player either way: the hirer chose to withdraw.
        await this.lockCalendars(tx, [order.hirerId, order.playerId]);
        await this.wallet.refundEscrow(tx, { orderId: order.id, hirerId: order.hirerId });
      }

      const [cancelled] = await tx
        .update(orders)
        .set({
          status: 'CLOSED',
          closeReason: 'CANCELLED_BY_HIRER',
          reason,
          endedAt: now,
          updatedAt: now,
        })
        .where(eq(orders.id, order.id))
        .returning();

      await tx.insert(orderStatusHistory).values({
        orderId: order.id,
        fromStatus: order.status,
        toStatus: 'CLOSED',
        actorId: hirerId,
        reason: booked ? 'Người thuê hủy lịch hẹn trước giờ bắt đầu' : 'Người thuê đã hủy',
      });

      await this.notifications.send(tx, {
        userId: order.playerId,
        title: booked ? 'Lịch hẹn đã bị hủy' : 'Yêu cầu thuê đã bị hủy',
        body: booked
          ? 'Người thuê đã hủy lịch hẹn và được hoàn lại toàn bộ số tiền đang giữ.'
          : 'Người thuê đã hủy yêu cầu.',
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
      const order = await this.lockOrder(tx, {
        orderId,
        actorId,
        role: 'participant',
        expected: SETTLEABLE_STATUSES,
      });
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
      const order = await this.lockOrder(tx, {
        orderId,
        actorId,
        role: 'participant',
        expected: LIVE_ONLY,
      });
      if (!order.startsAt) {
        throw AppError.conflict(ErrorCode.invalidOrderState, `Order is ${order.status}, not LIVE`);
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

      const endedEarlyBy = order.hirerId === actorId ? 'HIRER' : 'PLAYER';

      const [ended] = await tx
        .update(orders)
        .set({
          status: 'ENDED_EARLY',
          endedEarlyBy,
          endedAt: now,
          reason: dto.reason ?? null,
          playerPayout: settlement.payout,
          updatedAt: now,
        })
        .where(eq(orders.id, order.id))
        .returning();

      await tx.insert(orderStatusHistory).values({
        orderId: order.id,
        fromStatus: 'LIVE',
        toStatus: 'ENDED_EARLY',
        actorId,
        reason: dto.reason ?? `Kết thúc sớm sau ${quote.tenths}/10 thời lượng`,
      });

      await tx
        .update(users)
        .set({ status: 'ONLINE', updatedAt: now })
        .where(eq(users.id, order.playerId));

      await this.notifications.sendMany(tx, [
        {
          userId: order.hirerId,
          title: 'Lượt thuê kết thúc sớm',
          body: `Lượt thuê kết thúc sớm. Bạn đã được hoàn ${formatVnd(quote.refund)} vào ví.`,
          referenceUrl: `/orders/${order.id}`,
        },
        {
          userId: order.playerId,
          title: 'Lượt thuê kết thúc sớm',
          body: 'Lượt thuê kết thúc sớm. Thu nhập của bạn đang chờ được giải ngân.',
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
          inArray(orders.status, [...OPEN_STATUSES]),
        ),
      )
      .for('update');

    for (const order of active) {
      // Anything past the proposal stage already has the hirer's money in
      // escrow; a proposal does not.
      if (order.status !== 'PROPOSED') {
        await this.wallet.refundEscrow(tx, { orderId: order.id, hirerId: order.hirerId });
        await tx
          .update(users)
          .set({ status: 'ONLINE', updatedAt: now })
          .where(eq(users.id, order.playerId));
      }

      await tx
        .update(orders)
        .set({
          status: 'CLOSED',
          closeReason: 'INTERRUPTED_BY_ADMIN',
          endedAt: now,
          reason: reason.slice(0, 500),
          updatedAt: now,
        })
        .where(eq(orders.id, order.id));

      await tx.insert(orderStatusHistory).values({
        orderId: order.id,
        fromStatus: order.status,
        toStatus: 'CLOSED',
        actorId,
        reason,
      });

      const counterpartId = order.hirerId === userId ? order.playerId : order.hirerId;
      await this.notifications.send(tx, {
        userId: counterpartId,
        title: 'Đơn bị tạm dừng',
        body: `Đơn của bạn bị tạm dừng: ${reason}. Số tiền đang giữ đã được hoàn lại cho người thuê.`,
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
      .where(and(eq(orders.status, 'PROPOSED'), lte(orders.respondBy, now)))
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

  /**
   * A booked session starts on its own, at the hour the slot promises. Nothing
   * about the money changes here — escrow was already held when the player
   * accepted — so this only moves the order onto the running track and claims
   * the player for the length of the session.
   */
  async startDueSessions(): Promise<number> {
    const now = this.clock.now();
    const due = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.status, 'SCHEDULED'), lte(orders.startsAt, now)))
      .limit(100);

    let started = 0;
    for (const row of due) {
      try {
        await this.db.transaction(async (tx) => {
          const [order] = await tx.select().from(orders).where(eq(orders.id, row.id)).for('update');
          if (!order || order.status !== 'SCHEDULED') return;

          await tx.update(orders).set({ status: 'LIVE', updatedAt: now }).where(eq(orders.id, order.id));

          await tx.insert(orderStatusHistory).values({
            orderId: order.id,
            fromStatus: 'SCHEDULED',
            toStatus: 'LIVE',
            actorId: null,
            reason: 'Lịch hẹn tự động bắt đầu đúng giờ đã đặt',
          });

          await tx
            .update(users)
            .set({ status: 'BUSY', updatedAt: now })
            .where(eq(users.id, order.playerId));

          await this.notifications.sendMany(tx, [
            {
              userId: order.hirerId,
              title: 'Lượt thuê đã bắt đầu',
              body: `Buổi hẹn đã bắt đầu, kéo dài ${order.hours} giờ.`,
              referenceUrl: `/orders/${order.id}`,
            },
            {
              userId: order.playerId,
              title: 'Lượt thuê đã bắt đầu',
              body: 'Buổi hẹn của bạn đã bắt đầu.',
              referenceUrl: `/orders/${order.id}`,
            },
          ]);
        });
        started += 1;
      } catch (error) {
        this.logger.warn(`Failed to start booked order ${row.id}: ${(error as Error).message}`);
      }
    }
    return started;
  }

  /**
   * The session clock ran out, so the session is over — but the money does not
   * move yet. The order waits in DISPUTED for the objection window, during which
   * either party can file a report and hold the payout for a moderator, or tap
   * complete to release it now. This replaces the old behaviour of paying the
   * player in full the second `scheduled_end_at` passed, with no confirmation
   * from the hirer who paid for the session.
   */
  async openDisputeWindow(): Promise<number> {
    const now = this.clock.now();
    const due = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.status, 'LIVE'), lte(orders.scheduledEndAt, now)))
      .limit(100);

    let opened = 0;
    for (const row of due) {
      try {
        await this.db.transaction(async (tx) => {
          const [order] = await tx.select().from(orders).where(eq(orders.id, row.id)).for('update');
          if (!order || order.status !== 'LIVE') return;

          const endedAt = order.scheduledEndAt ?? now;
          await tx
            .update(orders)
            .set({ status: 'DISPUTED', endedAt, disputedAt: now, updatedAt: now })
            .where(eq(orders.id, order.id));

          await tx.insert(orderStatusHistory).values({
            orderId: order.id,
            fromStatus: 'LIVE',
            toStatus: 'DISPUTED',
            actorId: null,
            reason: 'Cuộc hẹn kết thúc theo lịch; tiền đang chờ đối soát',
          });

          await tx
            .update(users)
            .set({ status: 'ONLINE', updatedAt: now })
            .where(eq(users.id, order.playerId));

          const windowHours = await this.configs.getNumber(CONFIG_KEYS.disputeWindowHours);
          await this.notifications.sendMany(tx, [
            {
              userId: order.hirerId,
              title: 'Xác nhận lượt thuê',
              body:
                windowHours > 0
                  ? `Lượt thuê đã kết thúc. Tiền của bạn sẽ tự động chuyển cho người chơi sau ${windowHours} giờ — bấm Hoàn thành để chuyển ngay, hoặc Báo cáo nếu có vấn đề.`
                  : 'Lượt thuê đã kết thúc và tiền đang được chuyển cho người chơi. Hãy Báo cáo nếu có vấn đề.',
              referenceUrl: `/orders/${order.id}`,
            },
            {
              userId: order.playerId,
              title: 'Lượt thuê đã kết thúc',
              body:
                windowHours > 0
                  ? `Bạn nhận được tiền khi người thuê xác nhận hoặc sau ${windowHours} giờ.`
                  : 'Thu nhập của bạn đang được giải ngân.',
              referenceUrl: `/orders/${order.id}`,
            },
          ]);
        });
        opened += 1;
      } catch (error) {
        this.logger.warn(`Failed to open the dispute window for order ${row.id}: ${(error as Error).message}`);
      }
    }
    return opened;
  }

  /**
   * Releases payouts whose objection window has closed. An unresolved report is
   * the objection itself, so an order with one stays in DISPUTED until a
   * moderator decides — the money never leaves escrow while a case is open.
   */
  async settleDueDisputes(): Promise<number> {
    const now = this.clock.now();
    const windowHours = await this.configs.getNumber(CONFIG_KEYS.disputeWindowHours);
    const cutoff = addHours(now, -windowHours);

    const due = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.status, 'DISPUTED'), lte(orders.disputedAt, cutoff)))
      .limit(100);

    let settled = 0;
    for (const row of due) {
      try {
        await this.db.transaction(async (tx) => {
          const [order] = await tx.select().from(orders).where(eq(orders.id, row.id)).for('update');
          if (!order || order.status !== 'DISPUTED') return;

          const [openReport] = await tx
            .select({ id: reports.id })
            .from(reports)
            .where(and(eq(reports.orderId, order.id), eq(reports.status, 'PENDING')))
            .limit(1);
          if (openReport) return;

          await this.settleCompletion(tx, order, now, null);
        });
        settled += 1;
      } catch (error) {
        this.logger.warn(`Failed to settle disputed order ${row.id}: ${(error as Error).message}`);
      }
    }
    return settled;
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
        status: 'SETTLED',
        endedAt: order.scheduledEndAt ?? now,
        playerPayout: settlement.payout,
        updatedAt: now,
      })
      .where(eq(orders.id, order.id))
      .returning();

    await tx.insert(orderStatusHistory).values({
      orderId: order.id,
      fromStatus: order.status,
      toStatus: 'SETTLED',
      actorId,
      reason: actorId ? 'Người tham gia xác nhận hoàn thành' : 'Hết thời gian khiếu nại mà không có báo cáo',
    });

    await tx
      .update(users)
      .set({ status: 'ONLINE', updatedAt: now })
      .where(eq(users.id, order.playerId));

    await this.notifications.sendMany(tx, [
      {
        userId: order.hirerId,
        title: 'Lượt thuê hoàn thành',
        body: 'Lượt thuê đã hoàn thành. Hãy đánh giá để giúp cộng đồng.',
        referenceUrl: `/orders/${order.id}`,
      },
      {
        userId: order.playerId,
        title: 'Lượt thuê hoàn thành',
        body: 'Thu nhập đang chờ và sẽ khả dụng trong ít phút.',
        referenceUrl: `/orders/${order.id}`,
      },
    ]);

    await this.stats.recompute(order.playerId, tx);
    return completed;
  }

  private async expireOrder(orderId: string, now: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!order || order.status !== 'PROPOSED') return;

      await tx
        .update(orders)
        .set({ status: 'CLOSED', closeReason: 'EXPIRED', endedAt: now, updatedAt: now })
        .where(eq(orders.id, order.id));

      await tx.insert(orderStatusHistory).values({
        orderId: order.id,
        fromStatus: 'PROPOSED',
        toStatus: 'CLOSED',
        actorId: null,
        reason: 'Người chơi không phản hồi trước hạn',
      });

      await this.behavior.adjust(
        tx,
        order.playerId,
        'ORDER_EXPIRED',
        { points: -1, satisfaction: -2 },
        order.id,
        'Bỏ lỡ yêu cầu thuê',
      );

      // Missing one request costs behaviour points. It used to also switch
      // player mode off and force the player back to ONLINE, so one missed
      // notification while asleep unpublished a player's whole listing and put
      // them online against their will. One strike per offence is enough.
      await this.notifications.sendMany(tx, [
        {
          userId: order.playerId,
          title: 'Yêu cầu thuê đã hết hạn',
          body: 'Yêu cầu thuê đã hết hạn trước khi bạn phản hồi. Điểm hành vi của bạn đã bị điều chỉnh.',
          referenceUrl: `/orders/${order.id}`,
        },
        {
          userId: order.hirerId,
          title: 'Yêu cầu thuê đã hết hạn',
          body: 'Người chơi không phản hồi kịp. Bạn chưa bị trừ khoản nào.',
          referenceUrl: `/orders/${order.id}`,
        },
      ]);
    });
  }

  /**
   * `startsAt` is what turns the hours a player publishes into a booking. When
   * it is absent the session starts the moment the player accepts, which is the
   * "hire now" path and behaves exactly as it always did.
   */
  private parseRequestedStart(value?: string): Date | null {
    if (value === undefined) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw AppError.unprocessable(ErrorCode.validationFailed, 'startsAt is not a valid ISO-8601 timestamp');
    }
    // Published slots are whole minutes, so a start carrying seconds would make
    // the coverage arithmetic one minute stricter than the player intended.
    return new Date(Math.floor(parsed.getTime() / MS_MINUTE) * MS_MINUTE);
  }

  private async resolveBookedSlot(
    tx: DbExecutor,
    args: { playerId: string; hours: number; requestedStart: Date; now: Date },
  ): Promise<{ startsAt: Date; scheduledEndAt: Date }> {
    if (args.requestedStart.getTime() <= args.now.getTime()) {
      throw AppError.conflict(
        ErrorCode.slotConflict,
        'The chosen start time has already passed; hire now or pick another slot',
      );
    }
    const horizon = args.now.getTime() + BOOKING_HORIZON_DAYS * MS_DAY;
    if (args.requestedStart.getTime() > horizon) {
      throw AppError.badRequest(
        ErrorCode.slotOutsideAvailability,
        `Sessions can only be booked up to ${BOOKING_HORIZON_DAYS} days ahead`,
      );
    }

    const windows = await tx
      .select({
        dayOfWeek: availabilityWindows.dayOfWeek,
        startMinute: availabilityWindows.startMinute,
        endMinute: availabilityWindows.endMinute,
      })
      .from(availabilityWindows)
      .where(eq(availabilityWindows.userId, args.playerId));

    if (windows.length === 0) {
      throw AppError.badRequest(
        ErrorCode.playerUnavailable,
        'This player has not published their hours, so they cannot be booked in advance',
      );
    }

    const scheduledEndAt = addHours(args.requestedStart, args.hours);
    if (!isSlotCovered(args.requestedStart, scheduledEndAt, windows, this.timeZone)) {
      throw AppError.unprocessable(
        ErrorCode.slotOutsideAvailability,
        'That time is outside the hours this player publishes',
      );
    }

    return { startsAt: args.requestedStart, scheduledEndAt };
  }

  /**
   * A proposal reserves nothing, so two hirers can put requests on the same free
   * slot; only one of them may end up owning it. The overlap test is a range
   * question, which no unique index can answer, so it runs here under
   * `lockCalendars` and `orders_one_live_per_*` stays as the backstop for the
   * one case that must never exist: two sessions running at once.
   */
  private async assertSlotFree(
    tx: DbExecutor,
    args: { hirerId: string; playerId: string; startsAt: Date; scheduledEndAt: Date; orderId?: string },
  ): Promise<void> {
    const filters = [
      inArray(orders.status, [...SESSION_STATUSES]),
      lt(orders.startsAt, args.scheduledEndAt),
      gt(orders.scheduledEndAt, args.startsAt),
      or(eq(orders.hirerId, args.hirerId), eq(orders.playerId, args.playerId)),
    ];
    if (args.orderId) filters.push(ne(orders.id, args.orderId));

    const [conflict] = await tx
      .select({ id: orders.id, hirerId: orders.hirerId })
      .from(orders)
      .where(and(...filters))
      .limit(1);

    if (!conflict) return;
    throw AppError.conflict(
      ErrorCode.slotConflict,
      conflict.hirerId === args.hirerId
        ? 'You already have another session at that time'
        : 'This player already has a session at that time',
    );
  }

  /**
   * Transaction-scoped advisory locks taken in a stable order, so two bookings
   * for the same player cannot interleave and cannot deadlock against each
   * other. A `hashtext` collision only serializes a few extra bookings.
   */
  private async lockCalendars(tx: DbExecutor, userIds: readonly string[]): Promise<void> {
    for (const userId of [...new Set(userIds)].sort()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    }
  }

  private async findOrder(orderId: string): Promise<Order> {
    const [order] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) throw AppError.notFound(ErrorCode.orderNotFound, 'Order not found');
    return order;
  }

  private async lockOrder(
    tx: DbExecutor,
    params: {
      orderId: string;
      actorId: string;
      role: 'player' | 'hirer' | 'participant';
      expected: readonly OrderStatus[];
      statusMessage?: string;
    },
  ): Promise<Order> {
    const [order] = await tx.select().from(orders).where(eq(orders.id, params.orderId)).for('update');
    if (!order) throw AppError.notFound(ErrorCode.orderNotFound, 'Order not found');

    if (params.role === 'player' && order.playerId !== params.actorId) {
      throw AppError.forbidden(ErrorCode.orderNotParticipant, 'You are not the player of this order');
    }
    if (params.role === 'hirer' && order.hirerId !== params.actorId) {
      throw AppError.forbidden(ErrorCode.orderNotParticipant, 'You are not the hirer of this order');
    }
    if (
      params.role === 'participant' &&
      order.hirerId !== params.actorId &&
      order.playerId !== params.actorId
    ) {
      throw AppError.forbidden(ErrorCode.orderNotParticipant, 'You are not a participant of this order');
    }

    if (!params.expected.includes(order.status)) {
      throw AppError.conflict(
        ErrorCode.invalidOrderState,
        params.statusMessage ?? `Order is ${order.status}, not ${params.expected.join(' or ')}`,
      );
    }

    return order;
  }

  private async hydrate(rows: Order[], viewerId: string): Promise<OrderView[]> {
    if (rows.length === 0) return [];

    const userIds = [...new Set(rows.flatMap((row) => [row.hirerId, row.playerId]))];
    const orderIds = rows.map((row) => row.id);

    const [
      userRows,
      gameRows,
      ratedRows,
      reportedRows,
      feedbackHours,
      disputeHours,
      holdRows,
    ] = await Promise.all([
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
      this.db
        .select({ orderId: reports.orderId })
        .from(reports)
        .where(and(inArray(reports.orderId, orderIds), eq(reports.reporterId, viewerId))),
      this.configs.getNumber(CONFIG_KEYS.feedbackWindowHours),
      this.configs.getNumber(CONFIG_KEYS.disputeWindowHours),
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
    const reportedSet = new Set(reportedRows.map((row) => row.orderId));
    const holdMap = new Map(holdRows.map((row) => [row.orderId, row.status]));

    const now = this.clock.now();

    return rows.map((order) => {
      const hirer = userMap.get(order.hirerId);
      const player = userMap.get(order.playerId);
      if (!hirer || !player) {
        throw AppError.notFound(ErrorCode.userNotFound, 'Order participant no longer exists');
      }

      const isParticipant = order.hirerId === viewerId || order.playerId === viewerId;
      const disputeDeadline =
        order.status === 'DISPUTED' && order.disputedAt
          ? addHours(order.disputedAt, disputeHours).toISOString()
          : null;

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
        closeReason: order.closeReason,
        endedEarlyBy: order.endedEarlyBy,
        respondBy: order.respondBy.toISOString(),
        startsAt: order.startsAt?.toISOString() ?? null,
        scheduledEndAt: order.scheduledEndAt?.toISOString() ?? null,
        endedAt: order.endedAt?.toISOString() ?? null,
        disputedAt: order.disputedAt?.toISOString() ?? null,
        disputeDeadlineAt: disputeDeadline,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        hirer: toUserSummary(hirer, { includeEmail: isParticipant }),
        player: toUserSummary(player, { includeEmail: isParticipant }),
        games: gameMap.get(order.id) ?? [],
        canRate: canRateOrder({
          status: order.status,
          endedAt: order.endedAt,
          scheduledEndAt: order.scheduledEndAt,
          windowHours: feedbackHours,
          now,
          participant: isParticipant,
          ratedByViewer: ratedSet.has(order.id),
          reportedByViewer: reportedSet.has(order.id),
        }),
        hasRated: ratedSet.has(order.id),
        escrowStatus: (holdMap.get(order.id) ?? 'NONE'),
      };
    });
  }
}
