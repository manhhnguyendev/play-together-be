import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DB, type AppDatabase } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { offsetOf, paginated, type Paginated } from '../../common/pagination/pagination';
import { addHours, Clock } from '../../common/time/time';
import {
  adminAuditLogs,
  charities,
  charityWithdrawals,
  deposits,
  donations,
  escrowHolds,
  feedback,
  games,
  ledgerEntries,
  orderGames,
  orders,
  orderStatusHistory,
  pendingCredits,
  ratings,
  reports,
  users,
  wallets,
  withdrawals,
  type LedgerEntry,
  type Order,
} from '../../db/schema';
import { CONFIG_KEYS } from '../../db/schema/config';
import {
  DISPUTED_ORDER_STATUSES,
  PROPOSED_ORDER_STATUSES,
  SESSION_ORDER_STATUSES,
} from '../../db/schema/orders';
import { BehaviorService } from '../behavior/behavior.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { toUserSummary } from '../users/user.mapper';
import type {
  AdminAuditLogView,
  AdminDepositView,
  AdminEscrowView,
  AdminKpisDto,
  AdminLedgerPage,
  AdminOrderDetailDto,
  AdminOrderRowDto,
  AdminUserDossierDto,
  AdminWalletView,
  KpiQueueBlock,
  ListAdminAuditQuery,
  ListAdminDepositsQuery,
  ListAdminEscrowsQuery,
  ListAdminLedgerQuery,
  ListAdminOrdersQuery,
  ListAdminWalletsQuery,
  AdminKpisQuery,
} from './admin-ops.dto';

const hirerTable = alias(users, 'hirer');
const playerTable = alias(users, 'player');
const actorTable = alias(users, 'actor');
const raterTable = alias(users, 'rater');
const rateeTable = alias(users, 'ratee');
const reporterTable = alias(users, 'reporter');
const targetTable = alias(users, 'target');
const adminTable = alias(users, 'audit_admin');
const accountTable = alias(users, 'deposit_account');

/** Money that left the platform account for a non-user entity has no name to show. */
const HOLDER_LABELS: Record<string, string> = {
  PLATFORM: 'Play Together (nền tảng)',
  ESCROW: 'Tiền đang giữ hộ',
  EXTERNAL: 'Đơn vị thanh toán',
};

const REFUND_LEDGER_TYPES = ['ESCROW_REFUND', 'REPORT_REFUND', 'MAINTENANCE_REFUND'] as const;

@Injectable()
export class AdminOpsService {
  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly clock: Clock,
    private readonly configs: SystemConfigService,
    private readonly behavior: BehaviorService,
  ) {}

  async auditLogs(query: ListAdminAuditQuery): Promise<Paginated<AdminAuditLogView>> {
    const where = this.auditFilters(query);

    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          log: adminAuditLogs,
          admin: { id: adminTable.id, name: adminTable.name, adminRole: adminTable.adminRole },
        })
        .from(adminAuditLogs)
        .leftJoin(adminTable, eq(adminTable.id, adminAuditLogs.adminId))
        .where(where)
        .orderBy(desc(adminAuditLogs.createdAt), desc(adminAuditLogs.id))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(adminAuditLogs).where(where),
    ]);

    return paginated(
      rows.map(({ log, admin }) => ({
        id: log.id,
        admin: admin?.id ? { id: admin.id, name: admin.name, adminRole: admin.adminRole } : null,
        action: log.action,
        entity: log.entity,
        entityId: log.entityId,
        reason: log.reason,
        detail: log.detail,
        createdAt: log.createdAt.toISOString(),
      })),
      total?.value ?? 0,
      query.page,
      query.pageSize,
    );
  }

  async orders(query: ListAdminOrdersQuery): Promise<Paginated<AdminOrderRowDto>> {
    const filters: SQL[] = [];
    if (query.status) filters.push(eq(orders.status, query.status));
    if (query.hirerId) filters.push(eq(orders.hirerId, query.hirerId));
    if (query.playerId) filters.push(eq(orders.playerId, query.playerId));
    if (query.q) {
      const pattern = `%${query.q}%`;
      filters.push(or(ilike(hirerTable.name, pattern), ilike(playerTable.name, pattern))!);
    }
    if (query.from) {
      const from = this.parseBound(query.from, 'from');
      filters.push(gte(orders.createdAt, from));
    }
    if (query.to) {
      const to = this.parseBound(query.to, 'to');
      filters.push(lte(orders.createdAt, to));
    }
    const where = filters.length ? and(...filters) : undefined;
    const sortColumn =
      query.sort === 'startsAt' ? orders.startsAt : query.sort === 'endedAt' ? orders.endedAt : orders.createdAt;

    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          order: orders,
          hirer: { id: hirerTable.id, name: hirerTable.name },
          player: { id: playerTable.id, name: playerTable.name },
        })
        .from(orders)
        .innerJoin(hirerTable, eq(hirerTable.id, orders.hirerId))
        .innerJoin(playerTable, eq(playerTable.id, orders.playerId))
        .where(where)
        // Newest first, but a session that never got a slot stays below the ones
        // that did: Postgres puts NULL first when descending, which reads as
        // "nothing scheduled" on top of the calendar an operator is scanning.
        .orderBy(sql`${sortColumn} DESC NULLS LAST`, desc(orders.id))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db
        .select({ value: count() })
        .from(orders)
        .innerJoin(hirerTable, eq(hirerTable.id, orders.hirerId))
        .innerJoin(playerTable, eq(playerTable.id, orders.playerId))
        .where(where),
    ]);

    const gamesByOrder = await this.gamesByOrder(rows.map(({ order }) => order.id));

    return paginated(
      rows.map(({ order, hirer, player }) => this.toOrderRow(order, hirer, player, gamesByOrder.get(order.id) ?? [])),
      total?.value ?? 0,
      query.page,
      query.pageSize,
    );
  }

  async orderDetail(orderId: string): Promise<AdminOrderDetailDto> {
    const [head] = await this.db
      .select({
        order: orders,
        hirer: { id: hirerTable.id, name: hirerTable.name },
        player: { id: playerTable.id, name: playerTable.name },
      })
      .from(orders)
      .innerJoin(hirerTable, eq(hirerTable.id, orders.hirerId))
      .innerJoin(playerTable, eq(playerTable.id, orders.playerId))
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!head) throw AppError.notFound(ErrorCode.orderNotFound, 'Order not found');

    const [gamesByOrder, history, escrows, ledger, pending, ratingRows, reportRows] = await Promise.all([
      this.gamesByOrder([orderId]),
      this.db
        .select({
          item: orderStatusHistory,
          actor: { id: actorTable.id, name: actorTable.name },
        })
        .from(orderStatusHistory)
        .leftJoin(actorTable, eq(actorTable.id, orderStatusHistory.actorId))
        .where(eq(orderStatusHistory.orderId, orderId))
        .orderBy(asc(orderStatusHistory.createdAt)),
      this.db.select().from(escrowHolds).where(eq(escrowHolds.orderId, orderId)).limit(1),
      this.db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, orderId)).orderBy(asc(ledgerEntries.createdAt)),
      this.db.select().from(pendingCredits).where(eq(pendingCredits.orderId, orderId)),
      this.db
        .select({
          rating: ratings,
          rater: { id: raterTable.id, name: raterTable.name },
          ratee: { id: rateeTable.id, name: rateeTable.name },
        })
        .from(ratings)
        .innerJoin(raterTable, eq(raterTable.id, ratings.raterId))
        .innerJoin(rateeTable, eq(rateeTable.id, ratings.rateeId))
        .where(eq(ratings.orderId, orderId))
        .orderBy(asc(ratings.createdAt)),
      this.db
        .select({
          report: reports,
          reporter: { id: reporterTable.id, name: reporterTable.name },
          target: { id: targetTable.id, name: targetTable.name },
        })
        .from(reports)
        .innerJoin(reporterTable, eq(reporterTable.id, reports.reporterId))
        .innerJoin(targetTable, eq(targetTable.id, reports.targetId))
        .where(eq(reports.orderId, orderId))
        .orderBy(asc(reports.createdAt)),
    ]);

    const escrow = escrows[0];
    const inDispute = head.order.status === 'DISPUTED' && head.order.disputedAt;
    const windowHours = inDispute ? await this.configs.getNumber(CONFIG_KEYS.disputeWindowHours) : null;

    return {
      order: this.toOrderRow(
        head.order,
        head.hirer,
        head.player,
        gamesByOrder.get(orderId) ?? [],
      ),
      message: head.order.message,
      reason: head.order.reason,
      history: history.map(({ item, actor }) => ({
        id: item.id,
        fromStatus: item.fromStatus,
        toStatus: item.toStatus,
        actor: actor?.id ? { id: actor.id, name: actor.name } : null,
        reason: item.reason,
        createdAt: item.createdAt.toISOString(),
      })),
      escrow: escrow
        ? {
            id: escrow.id,
            status: escrow.status,
            amount: escrow.amount,
            settledAmount: escrow.settledAmount,
            refundedAmount: escrow.refundedAmount,
            heldAmount: escrow.amount - escrow.settledAmount - escrow.refundedAmount,
            createdAt: escrow.createdAt.toISOString(),
            updatedAt: escrow.updatedAt.toISOString(),
          }
        : null,
      ledger: await this.mapLedger(ledger),
      pendingCredits: pending.map((credit) => ({
        id: credit.id,
        amount: credit.amount,
        availableAt: credit.availableAt.toISOString(),
        releasedAt: credit.releasedAt?.toISOString() ?? null,
      })),
      ratings: ratingRows.map(({ rating, rater, ratee }) => ({
        id: rating.id,
        rater,
        ratee,
        rate: rating.rate,
        comment: rating.comment,
        isActive: rating.isActive,
        violationStatus: rating.violationStatus,
        createdAt: rating.createdAt.toISOString(),
      })),
      reports: reportRows.map(({ report, reporter, target }) => ({
        id: report.id,
        reporter,
        target,
        message: report.message,
        status: report.status,
        resolutionNote: report.resolutionNote,
        createdAt: report.createdAt.toISOString(),
      })),
      disputeWindowHours: windowHours,
      disputeClosesAt:
        inDispute && windowHours !== null ? addHours(head.order.disputedAt!, windowHours).toISOString() : null,
    };
  }

  /**
   * One account seen from the back office: who it is, how it has behaved, what
   * money it holds and what is still unresolved against it.
   */
  async userDossier(userId: string): Promise<AdminUserDossierDto> {
    const [head] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!head) throw AppError.notFound(ErrorCode.userNotFound, 'User not found');

    const openStatuses = [...PROPOSED_ORDER_STATUSES, ...SESSION_ORDER_STATUSES, ...DISPUTED_ORDER_STATUSES];

    const [
      behaviorView,
      behaviorHistoryPage,
      [walletRow],
      [asHirer],
      [asPlayer],
      [openOrders],
      recentRows,
      [reportsAgainst],
      [reportsFiled],
      [flaggedRatings],
      withdrawalRows,
    ] = await Promise.all([
      this.behavior.get(userId),
      this.behavior.history(userId, { page: 1, pageSize: 20 }),
      this.db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1),
      this.db.select({ value: count() }).from(orders).where(eq(orders.hirerId, userId)),
      this.db.select({ value: count() }).from(orders).where(eq(orders.playerId, userId)),
      this.db
        .select({ value: count() })
        .from(orders)
        .where(
          and(
            inArray(orders.status, openStatuses),
            or(eq(orders.hirerId, userId), eq(orders.playerId, userId)),
          ),
        ),
      this.db
        .select({
          order: orders,
          hirer: { id: hirerTable.id, name: hirerTable.name },
          player: { id: playerTable.id, name: playerTable.name },
        })
        .from(orders)
        .innerJoin(hirerTable, eq(hirerTable.id, orders.hirerId))
        .innerJoin(playerTable, eq(playerTable.id, orders.playerId))
        .where(or(eq(orders.hirerId, userId), eq(orders.playerId, userId)))
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(5),
      this.db
        .select({ value: count() })
        .from(reports)
        .where(and(eq(reports.targetId, userId), eq(reports.status, 'PENDING'))),
      this.db.select({ value: count() }).from(reports).where(eq(reports.reporterId, userId)),
      this.db
        .select({ value: count() })
        .from(ratings)
        .where(and(eq(ratings.rateeId, userId), eq(ratings.violationStatus, 'FLAGGED'))),
      this.db
        .select({
          count: count(),
          amount: sql<number>`coalesce(sum(${withdrawals.amount}), 0)`,
        })
        .from(withdrawals)
        .where(and(eq(withdrawals.userId, userId), eq(withdrawals.status, 'PENDING'))),
    ]);

    const gamesByOrder = await this.gamesByOrder(recentRows.map(({ order }) => order.id));
    const wallet = walletRow
      ? {
          walletId: walletRow.id,
          availableBalance: walletRow.availableBalance,
          pendingAmount: 0,
          pendingCount: 0,
          updatedAt: walletRow.updatedAt.toISOString(),
        }
      : null;

    if (wallet) {
      const pending = await this.pendingByWallet([wallet.walletId]);
      const summary = pending.get(wallet.walletId);
      wallet.pendingAmount = summary?.amount ?? 0;
      wallet.pendingCount = summary?.count ?? 0;
    }

    return {
      account: toUserSummary(head, { includeEmail: true }),
      behavior: {
        points: behaviorView.points,
        satisfaction: behaviorView.satisfaction,
        history: behaviorHistoryPage.items,
      },
      wallet,
      orders: {
        asHirer: Number(asHirer?.value ?? 0),
        asPlayer: Number(asPlayer?.value ?? 0),
        open: Number(openOrders?.value ?? 0),
        recent: recentRows.map(({ order, hirer, player }) =>
          this.toOrderRow(order, hirer, player, gamesByOrder.get(order.id) ?? []),
        ),
      },
      moderation: {
        openReportsAgainst: Number(reportsAgainst?.value ?? 0),
        reportsFiled: Number(reportsFiled?.value ?? 0),
        flaggedRatings: Number(flaggedRatings?.value ?? 0),
        pendingWithdrawals: Number(withdrawalRows[0]?.count ?? 0),
        pendingWithdrawalAmount: Number(withdrawalRows[0]?.amount ?? 0),
      },
    };
  }

  async ledger(query: ListAdminLedgerQuery): Promise<AdminLedgerPage> {
    const filters: SQL[] = [];
    if (query.accountType) filters.push(eq(ledgerEntries.accountType, query.accountType));
    if (query.type) filters.push(eq(ledgerEntries.type, query.type));
    if (query.direction) filters.push(eq(ledgerEntries.direction, query.direction));
    if (query.orderId) filters.push(eq(ledgerEntries.orderId, query.orderId));
    if (query.walletId) filters.push(eq(ledgerEntries.walletId, query.walletId));
    if (query.minAmount !== undefined) filters.push(gte(ledgerEntries.amount, query.minAmount));
    if (query.maxAmount !== undefined) filters.push(lte(ledgerEntries.amount, query.maxAmount));
    if (query.from) filters.push(gte(ledgerEntries.createdAt, this.parseBound(query.from, 'from')));
    if (query.to) filters.push(lte(ledgerEntries.createdAt, this.parseBound(query.to, 'to')));
    const where = filters.length ? and(...filters) : undefined;

    const [rows, [totals]] = await Promise.all([
      this.db
        .select()
        .from(ledgerEntries)
        .where(where)
        .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      // One pass over the filtered set gives both the depth of the queue and the
      // money behind it, which is what distinguishes this page from a count.
      this.db
        .select({
          entries: count(),
          debits: sql<number>`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.direction} = 'DEBIT'), 0)`,
          credits: sql<number>`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.direction} = 'CREDIT'), 0)`,
        })
        .from(ledgerEntries)
        .where(where),
    ]);

    return {
      items: await this.mapLedger(rows),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: Number(totals?.entries ?? 0),
        totalPages: Math.ceil(Number(totals?.entries ?? 0) / query.pageSize),
      },
      totals: {
        debits: Number(totals?.debits ?? 0),
        credits: Number(totals?.credits ?? 0),
        entries: Number(totals?.entries ?? 0),
      },
    };
  }

  async wallets(query: ListAdminWalletsQuery): Promise<Paginated<AdminWalletView>> {
    const filters: SQL[] = [];
    if (query.q) {
      const pattern = `%${query.q}%`;
      filters.push(or(ilike(users.name, pattern), ilike(users.email, pattern))!);
    }
    if (query.pendingOnly === 'true') {
      filters.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(pendingCredits)
            .where(
              and(eq(pendingCredits.walletId, wallets.id), isNull(pendingCredits.releasedAt)),
            ),
        ),
      );
    }
    const where = filters.length ? and(...filters) : undefined;

    const [rows, [total]] = await Promise.all([
      this.db
        .select({ wallet: wallets, user: { id: users.id, name: users.name, email: users.email } })
        .from(wallets)
        .innerJoin(users, eq(users.id, wallets.userId))
        .where(where)
        .orderBy(desc(wallets.availableBalance), desc(wallets.id))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(wallets).innerJoin(users, eq(users.id, wallets.userId)).where(where),
    ]);

    const pending = await this.pendingByWallet(rows.map(({ wallet }) => wallet.id));

    return paginated(
      rows.map(({ wallet, user }) => {
        const summary = pending.get(wallet.id);
        return {
          walletId: wallet.id,
          userId: user.id,
          name: user.name,
          email: user.email,
          availableBalance: wallet.availableBalance,
          pendingAmount: summary?.amount ?? 0,
          pendingCount: summary?.count ?? 0,
          updatedAt: wallet.updatedAt.toISOString(),
        };
      }),
      total?.value ?? 0,
      query.page,
      query.pageSize,
    );
  }

  async deposits(query: ListAdminDepositsQuery): Promise<Paginated<AdminDepositView>> {
    const filters: SQL[] = [];
    if (query.status) filters.push(eq(deposits.status, query.status));
    if (query.minAmount !== undefined) filters.push(gte(deposits.amount, query.minAmount));
    if (query.maxAmount !== undefined) filters.push(lte(deposits.amount, query.maxAmount));
    if (query.from) filters.push(gte(deposits.createdAt, this.parseBound(query.from, 'from')));
    if (query.to) filters.push(lte(deposits.createdAt, this.parseBound(query.to, 'to')));
    if (query.q) {
      const pattern = `%${query.q}%`;
      filters.push(or(ilike(users.name, pattern), ilike(users.email, pattern))!);
    }
    const where = filters.length ? and(...filters) : undefined;

    const [rows, [total]] = await Promise.all([
      this.db
        .select({ deposit: deposits, user: { id: accountTable.id, name: accountTable.name } })
        .from(deposits)
        .innerJoin(accountTable, eq(accountTable.id, deposits.userId))
        .where(where)
        .orderBy(desc(deposits.createdAt), desc(deposits.id))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db
        .select({ value: count() })
        .from(deposits)
        .innerJoin(accountTable, eq(accountTable.id, deposits.userId))
        .where(where),
    ]);

    return paginated(
      rows.map(({ deposit, user }) => ({
        id: deposit.id,
        user,
        amount: deposit.amount,
        provider: deposit.provider,
        providerTxnId: deposit.providerTxnId,
        status: deposit.status,
        createdAt: deposit.createdAt.toISOString(),
        completedAt: deposit.completedAt?.toISOString() ?? null,
      })),
      total?.value ?? 0,
      query.page,
      query.pageSize,
    );
  }

  async escrows(query: ListAdminEscrowsQuery): Promise<Paginated<AdminEscrowView> & { totalHeld: number }> {
    const where = query.status ? eq(escrowHolds.status, query.status) : undefined;

    const [rows, [summary]] = await Promise.all([
      this.db
        .select({
          hold: escrowHolds,
          order: { id: orders.id, status: orders.status },
          hirer: { id: hirerTable.id, name: hirerTable.name },
          player: { id: playerTable.id, name: playerTable.name },
        })
        .from(escrowHolds)
        .innerJoin(orders, eq(orders.id, escrowHolds.orderId))
        .innerJoin(hirerTable, eq(hirerTable.id, orders.hirerId))
        .innerJoin(playerTable, eq(playerTable.id, orders.playerId))
        .where(where)
        .orderBy(desc(escrowHolds.createdAt), desc(escrowHolds.id))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db
        .select({
          value: count(),
          held: sql<number>`coalesce(sum(${escrowHolds.amount} - ${escrowHolds.settledAmount} - ${escrowHolds.refundedAmount}), 0)`,
        })
        .from(escrowHolds)
        .where(where),
    ]);

    const page = paginated(
      rows.map(({ hold, order, hirer, player }) => ({
        id: hold.id,
        orderId: order.id,
        orderStatus: order.status,
        hirer,
        player,
        amount: hold.amount,
        settledAmount: hold.settledAmount,
        refundedAmount: hold.refundedAmount,
        heldAmount: hold.amount - hold.settledAmount - hold.refundedAmount,
        status: hold.status,
        createdAt: hold.createdAt.toISOString(),
      })),
      summary?.value ?? 0,
      query.page,
      query.pageSize,
    );

    return { ...page, totalHeld: Number(summary?.held ?? 0) };
  }

  async kpis(query: AdminKpisQuery): Promise<AdminKpisDto> {
    const now = this.clock.now();
    const to = query.to ? this.parseBound(query.to, 'to') : now;
    // The floor is local midnight so a "today" window catches the first order of
    // the day, whatever time the console happens to ask at.
    const from = query.from
      ? this.parseBound(query.from, 'from')
      : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (from.getTime() > to.getTime()) {
      throw AppError.unprocessable(ErrorCode.validationFailed, '"from" must not be after "to"');
    }

    const [
      [created],
      transitionRows,
      [feeRows],
      [payoutRows],
      [refundRows],
      [payoutSum],
      [charityPayoutSum],
      [depositSum],
      [donationSum],
      queue,
      [registered],
      [activePlayers],
      [ratingAgg],
    ] = await Promise.all([
      this.db
        .select({ value: count() })
        .from(orders)
        .where(and(gte(orders.createdAt, from), lte(orders.createdAt, to))),
      // Transitions, not current status: an order settled last week must not be
      // counted as settled again because it is still SETTLED today.
      this.db
        .select({ toStatus: orderStatusHistory.toStatus, value: count() })
        .from(orderStatusHistory)
        .where(and(gte(orderStatusHistory.createdAt, from), lte(orderStatusHistory.createdAt, to)))
        .groupBy(orderStatusHistory.toStatus),
      this.db
        .select({ value: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)` })
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.type, 'PLATFORM_FEE'),
            eq(ledgerEntries.accountType, 'PLATFORM'),
            gte(ledgerEntries.createdAt, from),
            lte(ledgerEntries.createdAt, to),
          ),
        ),
      this.db
        .select({ value: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)` })
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.type, 'ORDER_EARNING'),
            eq(ledgerEntries.direction, 'CREDIT'),
            gte(ledgerEntries.createdAt, from),
            lte(ledgerEntries.createdAt, to),
          ),
        ),
      this.db
        .select({ value: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)` })
        .from(ledgerEntries)
        .where(
          and(
            inArray(ledgerEntries.type, REFUND_LEDGER_TYPES),
            // Only the credit side: the matching debit is the same money leaving
            // escrow, and adding both would report twice what was refunded.
            eq(ledgerEntries.direction, 'CREDIT'),
            gte(ledgerEntries.createdAt, from),
            lte(ledgerEntries.createdAt, to),
          ),
        ),
      this.db
        .select({ value: sql<number>`coalesce(sum(${withdrawals.amount}), 0)` })
        .from(withdrawals)
        .where(
          and(
            eq(withdrawals.status, 'PAID'),
            gte(withdrawals.processedAt, from),
            lte(withdrawals.processedAt, to),
          ),
        ),
      this.db
        .select({ value: sql<number>`coalesce(sum(${charityWithdrawals.amount}), 0)` })
        .from(charityWithdrawals)
        .where(
          and(
            eq(charityWithdrawals.status, 'PAID'),
            gte(charityWithdrawals.processedAt, from),
            lte(charityWithdrawals.processedAt, to),
          ),
        ),
      this.db
        .select({ value: sql<number>`coalesce(sum(${deposits.amount}), 0)` })
        .from(deposits)
        .where(
          and(
            eq(deposits.status, 'SUCCEEDED'),
            gte(deposits.completedAt, from),
            lte(deposits.completedAt, to),
          ),
        ),
      this.db
        .select({ value: sql<number>`coalesce(sum(${donations.amount}), 0)` })
        .from(donations)
        .where(and(gte(donations.createdAt, from), lte(donations.createdAt, to))),
      this.queueSnapshot(),
      this.db
        .select({ value: count() })
        .from(users)
        .where(and(gte(users.createdAt, from), lte(users.createdAt, to))),
      this.db
        .select({ value: count() })
        .from(users)
        .where(and(eq(users.isPlayer, true), eq(users.isActive, true))),
      this.db
        .select({
          value: sql<number>`coalesce(avg(${ratings.rate}), 0)`,
          total: count(),
        })
        .from(ratings)
        .where(and(eq(ratings.isActive, true), gte(ratings.createdAt, from), lte(ratings.createdAt, to))),
    ]);

    const transitions: Record<string, number> = {};
    for (const row of transitionRows) transitions[row.toStatus] = Number(row.value);
    const settled = transitions.SETTLED ?? 0;
    const endedEarly = transitions.ENDED_EARLY ?? 0;
    const disputed = transitions.DISPUTED ?? 0;
    const completed = settled + endedEarly;

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      orders: {
        created: Number(created?.value ?? 0),
        settled,
        endedEarly,
        disputed,
        closed: transitions.CLOSED ?? 0,
        completed,
        endedEarlyRateBps: completed === 0 ? 0 : Math.round((endedEarly / completed) * 10_000),
      },
      money: {
        playerPayouts: Number(payoutRows?.value ?? 0),
        platformFees: Number(feeRows?.value ?? 0),
        refunds: Number(refundRows?.value ?? 0),
        payoutsPaid: Number(payoutSum?.value ?? 0),
        charityPayoutsPaid: Number(charityPayoutSum?.value ?? 0),
        depositsSucceeded: Number(depositSum?.value ?? 0),
        donations: Number(donationSum?.value ?? 0),
      },
      queue,
      people: {
        registered: Number(registered?.value ?? 0),
        activePlayers: Number(activePlayers?.value ?? 0),
        ratingsCreated: Number(ratingAgg?.total ?? 0),
        averageRating:
          Number(ratingAgg?.total ?? 0) === 0 ? null : Number(Number(ratingAgg?.value ?? 0).toFixed(2)),
      },
    };
  }

  /** Depth and value of everything an operator still owes somebody. */
  private async queueSnapshot(): Promise<KpiQueueBlock> {
    const [
      [userPayouts],
      [charityPayouts],
      [escrow],
      [pending],
      [reportCount],
      [feedbackCount],
      [flaggedCount],
    ] = await Promise.all([
      this.db
        .select({
          total: count(),
          amount: sql<number>`coalesce(sum(${withdrawals.amount}), 0)`,
        })
        .from(withdrawals)
        .where(eq(withdrawals.status, 'PENDING')),
      this.db
        .select({
          total: count(),
          amount: sql<number>`coalesce(sum(${charityWithdrawals.amount}), 0)`,
        })
        .from(charityWithdrawals)
        .where(eq(charityWithdrawals.status, 'PENDING')),
      this.db
        .select({ value: sql<number>`coalesce(sum(${escrowHolds.amount} - ${escrowHolds.settledAmount} - ${escrowHolds.refundedAmount}), 0)` })
        .from(escrowHolds)
        .where(eq(escrowHolds.status, 'HELD')),
      this.db
        .select({ value: sql<number>`coalesce(sum(${pendingCredits.amount}), 0)` })
        .from(pendingCredits)
        .where(isNull(pendingCredits.releasedAt)),
      this.db.select({ value: count() }).from(reports).where(eq(reports.status, 'PENDING')),
      this.db.select({ value: count() }).from(feedback).where(eq(feedback.status, 'PENDING')),
      this.db.select({ value: count() }).from(ratings).where(eq(ratings.violationStatus, 'FLAGGED')),
    ]);

    return {
      pendingUserWithdrawals: Number(userPayouts?.total ?? 0),
      pendingUserWithdrawalAmount: Number(userPayouts?.amount ?? 0),
      pendingCharityWithdrawals: Number(charityPayouts?.total ?? 0),
      pendingCharityWithdrawalAmount: Number(charityPayouts?.amount ?? 0),
      escrowHeld: Number(escrow?.value ?? 0),
      pendingCredits: Number(pending?.value ?? 0),
      pendingReports: Number(reportCount?.value ?? 0),
      pendingFeedback: Number(feedbackCount?.value ?? 0),
      flaggedRatings: Number(flaggedCount?.value ?? 0),
    };
  }

  private auditFilters(query: ListAdminAuditQuery): SQL | undefined {
    const filters: SQL[] = [];
    if (query.adminId) filters.push(eq(adminAuditLogs.adminId, query.adminId));
    if (query.action) filters.push(eq(adminAuditLogs.action, query.action));
    if (query.entity) filters.push(eq(adminAuditLogs.entity, query.entity));
    if (query.entityId) filters.push(eq(adminAuditLogs.entityId, query.entityId));
    if (query.from) filters.push(gte(adminAuditLogs.createdAt, this.parseBound(query.from, 'from')));
    if (query.to) filters.push(lte(adminAuditLogs.createdAt, this.parseBound(query.to, 'to')));
    return filters.length ? and(...filters) : undefined;
  }

  private parseBound(value: string, name: 'from' | 'to'): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw AppError.unprocessable(ErrorCode.validationFailed, `"${name}" is not a valid ISO 8601 timestamp`);
    }
    return parsed;
  }

  private async gamesByOrder(orderIds: string[]): Promise<Map<string, Array<{ id: string; name: string }>>> {
    const map = new Map<string, Array<{ id: string; name: string }>>();
    if (orderIds.length === 0) return map;

    const rows = await this.db
      .select({ orderId: orderGames.orderId, id: games.id, name: games.name })
      .from(orderGames)
      .innerJoin(games, eq(games.id, orderGames.gameId))
      .where(inArray(orderGames.orderId, orderIds));

    for (const row of rows) {
      const list = map.get(row.orderId) ?? [];
      list.push({ id: row.id, name: row.name });
      map.set(row.orderId, list);
    }
    return map;
  }

  private toOrderRow(
    order: Order,
    hirer: { id: string; name: string },
    player: { id: string; name: string },
    gameList: Array<{ id: string; name: string }>,
  ): AdminOrderRowDto {
    return {
      id: order.id,
      status: order.status,
      closeReason: order.closeReason,
      endedEarlyBy: order.endedEarlyBy,
      hirer,
      player,
      hours: order.hours,
      hourlyRate: order.hourlyRate,
      totalPrice: order.totalPrice,
      feeBps: order.feeBps,
      playerPayout: order.playerPayout,
      games: gameList,
      startsAt: order.startsAt?.toISOString() ?? null,
      scheduledEndAt: order.scheduledEndAt?.toISOString() ?? null,
      endedAt: order.endedAt?.toISOString() ?? null,
      disputedAt: order.disputedAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
    };
  }

  /** Resolves `accountType + accountId` into something a human can read. */
  private async mapLedger(
    rows: Array<LedgerEntry>,
  ): Promise<Array<{
    id: string;
    transactionId: string;
    accountType: LedgerEntry['accountType'];
    direction: LedgerEntry['direction'];
    type: LedgerEntry['type'];
    amount: number;
    note: string | null;
    holder: string | null;
    orderId: string | null;
    createdAt: string;
  }>> {
    const userIds = [...new Set(rows.filter((row) => row.accountType === 'USER' && row.accountId).map((row) => row.accountId!))];
    const charityIds = [
      ...new Set(rows.filter((row) => row.accountType === 'CHARITY' && row.charityId).map((row) => row.charityId!)),
    ];

    const [userRows, charityRows] = await Promise.all([
      userIds.length
        ? this.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))
        : Promise.resolve([]),
      charityIds.length
        ? this.db
            .select({ id: charities.id, organizationName: charities.organizationName })
            .from(charities)
            .where(inArray(charities.id, charityIds))
        : Promise.resolve([]),
    ]);

    const nameByUser = new Map(userRows.map((row) => [row.id, row.name]));
    const nameByCharity = new Map(charityRows.map((row) => [row.id, row.organizationName]));

    return rows.map((row) => ({
      id: row.id,
      transactionId: row.transactionId,
      accountType: row.accountType,
      direction: row.direction,
      type: row.type,
      amount: row.amount,
      note: row.note,
      holder:
        row.accountType === 'USER'
          ? (nameByUser.get(row.accountId ?? '') ?? null)
          : row.accountType === 'CHARITY'
            ? (nameByCharity.get(row.charityId ?? '') ?? null)
            : (HOLDER_LABELS[row.accountType] ?? null),
      orderId: row.orderId,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async pendingByWallet(walletIds: string[]): Promise<Map<string, { amount: number; count: number }>> {
    const map = new Map<string, { amount: number; count: number }>();
    if (walletIds.length === 0) return map;

    const rows = await this.db
      .select({
        walletId: pendingCredits.walletId,
        amount: sql<number>`coalesce(sum(${pendingCredits.amount}), 0)`,
        count: count(),
      })
      .from(pendingCredits)
      .where(and(inArray(pendingCredits.walletId, walletIds), isNull(pendingCredits.releasedAt)))
      .groupBy(pendingCredits.walletId);

    for (const row of rows) map.set(row.walletId, { amount: Number(row.amount), count: Number(row.count) });
    return map;
  }
}
