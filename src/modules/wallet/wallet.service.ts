import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AuditService, AUDIT_ACTIONS } from '../../common/audit/audit.service';
import { DB, type AppDatabase, type DbExecutor } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { assertPositiveVnd, splitFee } from '../../common/money/money';
import { offsetOf, paginated, type Paginated } from '../../common/pagination/pagination';
import type { AuthUser } from '../../common/security/auth-user';
import { addHours, Clock, startOfDayInZone, timeZoneOffsetMs, zonedParts } from '../../common/time/time';
import {
  deposits,
  escrowHolds,
  ledgerEntries,
  orders,
  pendingCredits,
  users,
  wallets,
  withdrawals,
  type Wallet,
} from '../../db/schema';
import { MomoAdapter } from './momo.adapter';
import type {
  EarningsSummaryDto,
  ListTransactionsQuery,
  ListWithdrawalsQuery,
  MomoIpnDto,
  MyWithdrawalView,
  ReleasePendingCreditsResultDto,
  RequestWithdrawalDto,
  WalletSummary,
  WithdrawalResolutionDto,
  WithdrawalView,
} from './wallet.dto';

/**
 * Ledger `note` is copy, not a key: nothing in the system reads it back, both
 * consoles print it verbatim, and the mobile app derives its own row title from
 * the ledger `type`. So it is written in Vietnamese here — the language the
 * person reading the money trail actually speaks.
 */
export const LEDGER_NOTES = {
  deposit: 'Nạp tiền qua MoMo',
  withdrawalRequest: 'Yêu cầu rút tiền',
  withdrawalRejected: 'Rút tiền bị từ chối, đã hoàn về ví',
  withdrawalCancelled: 'Rút tiền bị huỷ, đã hoàn về ví',
  escrowHold: 'Tạm giữ tiền cho đơn thuê',
  escrowRefund: 'Hoàn phần tiền thuê chưa dùng cho người thuê',
  escrowReleased: 'Giải ngân tiền đơn thuê',
  orderEarning: 'Doanh thu đơn thuê (chờ về ví)',
  platformFee: 'Phí nền tảng',
  reportRefund: 'Hoàn tiền cho người thuê vì tố cáo đúng',
  reportClawback: 'Thu hồi tiền từ người chơi',
  reportCompensation: 'Bồi hoàn cho người thuê vì tố cáo đúng',
} as const;

export type LedgerEntryInput = {
  accountType: 'USER' | 'CHARITY' | 'PLATFORM' | 'ESCROW' | 'EXTERNAL';
  accountId?: string | null;
  walletId?: string | null;
  charityId?: string | null;
  orderId?: string | null;
  direction: 'DEBIT' | 'CREDIT';
  type:
    | 'DEPOSIT'
    | 'WITHDRAWAL'
    | 'ESCROW_HOLD'
    | 'ESCROW_RELEASE'
    | 'ESCROW_REFUND'
    | 'ORDER_EARNING'
    | 'PLATFORM_FEE'
    | 'DONATION'
    | 'REPORT_REFUND'
    | 'MAINTENANCE_REFUND'
    | 'CHARITY_WITHDRAWAL'
    | 'ADJUSTMENT';
  amount: number;
  note?: string | null;
};

export type SettlementResult = {
  fee: number;
  payout: number;
  refund: number;
  status: 'SETTLED' | 'REFUNDED' | 'PARTIALLY_SETTLED';
  pendingCreditId: string | null;
};

@Injectable()
export class WalletService {
  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly momo: MomoAdapter,
    private readonly clock: Clock,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async getOrCreateWallet(executor: DbExecutor, userId: string): Promise<Wallet> {
    const [existing] = await executor.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
    if (existing) return existing;

    const [created] = await executor
      .insert(wallets)
      .values({ userId })
      .onConflictDoNothing()
      .returning();

    if (created) return created;

    const [row] = await executor.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
    if (!row) throw AppError.notFound(ErrorCode.userNotFound, 'Wallet could not be created for this user');
    return row;
  }

  async lockWallet(executor: DbExecutor, userId: string): Promise<Wallet> {
    const wallet = await this.getOrCreateWallet(executor, userId);
    const [locked] = await executor.select().from(wallets).where(eq(wallets.id, wallet.id)).for('update');
    return locked;
  }

  /**
   * Adds to a wallet's available balance in SQL.
   *
   * Balances used to be read from a locked row, added to in JavaScript and
   * written back. That is only safe while every caller remembers the lock, and
   * nothing here makes them remember.
   */
  private async addToAvailable(tx: DbExecutor, walletId: string, amount: number): Promise<number> {
    assertPositiveVnd(amount, 'amount');

    const [row] = await tx
      .update(wallets)
      .set({ availableBalance: sql`${wallets.availableBalance} + ${amount}`, updatedAt: this.clock.now() })
      .where(eq(wallets.id, walletId))
      .returning({ availableBalance: wallets.availableBalance });

    if (!row) throw AppError.notFound(ErrorCode.notFound, 'Wallet not found');
    return row.availableBalance;
  }

  /**
   * Debits the available balance in SQL, and only if it covers the amount.
   * Returns null rather than throwing so each caller names its own failure: an
   * escrow hold and a withdrawal report the same shortfall to different people.
   */
  private async tryDebitAvailable(tx: DbExecutor, walletId: string, amount: number): Promise<number | null> {
    assertPositiveVnd(amount, 'amount');

    const [row] = await tx
      .update(wallets)
      .set({ availableBalance: sql`${wallets.availableBalance} - ${amount}`, updatedAt: this.clock.now() })
      .where(and(eq(wallets.id, walletId), gte(wallets.availableBalance, amount)))
      .returning({ availableBalance: wallets.availableBalance });

    return row ? row.availableBalance : null;
  }

  /**
   * Debits a wallet the caller has already locked. No guard here: the caller
   * worked out the affordable amount from the locked row, and
   * `wallets_available_check` rejects the transaction if that arithmetic was
   * ever wrong.
   */
  private async debitLocked(tx: DbExecutor, walletId: string, amount: number): Promise<void> {
    assertPositiveVnd(amount, 'amount');
    await tx
      .update(wallets)
      .set({ availableBalance: sql`${wallets.availableBalance} - ${amount}`, updatedAt: this.clock.now() })
      .where(eq(wallets.id, walletId));
  }

  /** Un-released earnings are the only definition of "pending". */
  private async pendingTotal(executor: DbExecutor, walletId: string): Promise<number> {
    const [row] = await executor
      .select({ total: sql<number>`coalesce(sum(${pendingCredits.amount}), 0)` })
      .from(pendingCredits)
      .where(and(eq(pendingCredits.walletId, walletId), isNull(pendingCredits.releasedAt)));

    return Number(row?.total ?? 0);
  }

  /** Append a balanced group of ledger rows under one transaction id. */
  async post(executor: DbExecutor, entries: LedgerEntryInput[]): Promise<string> {
    if (entries.length === 0) return randomUUID();
    for (const entry of entries) assertPositiveVnd(entry.amount, 'ledger amount');

    const transactionId = randomUUID();
    await executor.insert(ledgerEntries).values(
      entries.map((entry) => ({
        transactionId,
        accountType: entry.accountType,
        accountId: entry.accountId ?? null,
        walletId: entry.walletId ?? null,
        charityId: entry.charityId ?? null,
        orderId: entry.orderId ?? null,
        direction: entry.direction,
        type: entry.type,
        amount: entry.amount,
        note: entry.note ?? null,
      })),
    );
    return transactionId;
  }

  async getSummary(userId: string): Promise<WalletSummary> {
    const wallet = await this.getOrCreateWallet(this.db, userId);
    const credits = await this.db
      .select()
      .from(pendingCredits)
      .where(and(eq(pendingCredits.walletId, wallet.id), isNull(pendingCredits.releasedAt)))
      .orderBy(asc(pendingCredits.availableAt))
      .limit(50);

    return {
      walletId: wallet.id,
      availableBalance: wallet.availableBalance,
      pendingBalance: await this.pendingTotal(this.db, wallet.id),
      pendingCredits: credits.map((credit) => ({
        id: credit.id,
        orderId: credit.orderId,
        amount: credit.amount,
        availableAt: credit.availableAt.toISOString(),
      })),
    };
  }

  async earningsSummary(userId: string): Promise<EarningsSummaryDto> {
    const wallet = await this.getOrCreateWallet(this.db, userId);
    const now = this.clock.now();
    const timeZone = this.config.get<string>('APP_TIMEZONE') ?? 'Asia/Ho_Chi_Minh';
    const offset = timeZoneOffsetMs(now, timeZone);
    const dayStart = startOfDayInZone(now, timeZone);
    const parts = zonedParts(now, timeZone);
    const monthStart = new Date(Date.UTC(parts.year, parts.month - 1, 1, 0, 0, 0, 0) - offset);

    const [row] = await this.db
      .select({
        today: sql<number>`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.createdAt} >= ${dayStart}), 0)`,
        month: sql<number>`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.createdAt} >= ${monthStart}), 0)`,
        total: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.walletId, wallet.id),
          eq(ledgerEntries.type, 'ORDER_EARNING'),
          eq(ledgerEntries.direction, 'CREDIT'),
        ),
      );

    return {
      today: Number(row?.today ?? 0),
      thisMonth: Number(row?.month ?? 0),
      total: Number(row?.total ?? 0),
    };
  }

  /** Matures the caller's own credits that have passed their hold period. */
  async releaseDueCredits(userId: string): Promise<ReleasePendingCreditsResultDto> {
    const wallet = await this.getOrCreateWallet(this.db, userId);
    return { released: await this.releaseDuePendingCredits(wallet.id) };
  }

  async listTransactions(userId: string, query: ListTransactionsQuery): Promise<Paginated<unknown>> {    const wallet = await this.getOrCreateWallet(this.db, userId);
    const where = query.type
      ? and(eq(ledgerEntries.walletId, wallet.id), eq(ledgerEntries.type, query.type))
      : eq(ledgerEntries.walletId, wallet.id);

    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(ledgerEntries)
        .where(where)
        .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(ledgerEntries).where(where),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.id,
        transactionId: row.transactionId,
        type: row.type,
        direction: row.direction,
        amount: row.direction === 'CREDIT' ? row.amount : -row.amount,
        note: row.note,
        orderId: row.orderId,
        createdAt: row.createdAt.toISOString(),
      })),
      total?.value ?? 0,
      query.page,
      query.pageSize,
    );
  }

  async listDeposits(userId: string, page: number, pageSize: number): Promise<Paginated<unknown>> {
    const where = eq(deposits.userId, userId);
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(deposits)
        .where(where)
        .orderBy(desc(deposits.createdAt), desc(deposits.id))
        .limit(pageSize)
        .offset(offsetOf(page, pageSize)),
      this.db.select({ value: count() }).from(deposits).where(where),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.id,
        amount: row.amount,
        status: row.status,
        provider: row.provider,
        providerTxnId: row.providerTxnId,
        createdAt: row.createdAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
      })),
      total?.value ?? 0,
      page,
      pageSize,
    );
  }

  async listWithdrawals(userId: string, query: ListWithdrawalsQuery): Promise<Paginated<MyWithdrawalView>> {
    const where = query.status
      ? and(eq(withdrawals.userId, userId), eq(withdrawals.status, query.status))
      : eq(withdrawals.userId, userId);

    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(withdrawals)
        .where(where)
        .orderBy(desc(withdrawals.createdAt), desc(withdrawals.id))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(withdrawals).where(where),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.id,
        amount: row.amount,
        status: row.status,
        provider: row.provider,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
        processedAt: row.processedAt?.toISOString() ?? null,
      })),
      total?.value ?? 0,
      query.page,
      query.pageSize,
    );
  }

  async createDeposit(
    userId: string,
    amount: number,
  ): Promise<{ id: string; amount: number; status: string; paymentUrl: string; mock: boolean }> {
    assertPositiveVnd(amount, 'amount');
    const wallet = await this.getOrCreateWallet(this.db, userId);

    const [deposit] = await this.db
      .insert(deposits)
      .values({ userId, walletId: wallet.id, amount, provider: 'MOMO' })
      .returning();

    try {
      const payment = await this.momo.createPayment({
        depositId: deposit.id,
        amount,
        description: `PlayTogether top-up ${deposit.id}`,
      });

      return {
        id: deposit.id,
        amount: deposit.amount,
        status: deposit.status,
        paymentUrl: payment.paymentUrl,
        mock: payment.mock,
      };
    } catch (error) {
      // The deposit id is what the payment provider's webhook refers back to.
      // Deleting the row here leaves an inbound callback with nothing to match.
      await this.db
        .update(deposits)
        .set({ status: 'FAILED' })
        .where(eq(deposits.id, deposit.id));
      throw error;
    }
  }

  async confirmDeposit(userId: string, depositId: string): Promise<{ id: string; status: string }> {
    if (!this.momo.mock) {
      throw AppError.forbidden(
        ErrorCode.paymentNotConfigured,
        'Manual confirmation is only available while the payment adapter runs in mock mode',
      );
    }

    return this.db.transaction(async (tx) => {
      const deposit = await this.creditDeposit(tx, depositId, {
        userId,
        providerTxnId: `MOCK-${depositId}`,
      });
      return { id: deposit.id, status: deposit.status };
    });
  }

  async handleMomoIpn(payload: MomoIpnDto): Promise<{ handled: boolean }> {
    if (!this.momo.verifyIpn(payload)) {
      throw AppError.badRequest(ErrorCode.invalidSignature, 'Invalid payment signature');
    }

    return this.db.transaction(async (tx) => {
      const [deposit] = await tx.select().from(deposits).where(eq(deposits.id, payload.orderId)).for('update');
      if (!deposit) return { handled: false };

      if (payload.amount !== deposit.amount) {
        throw AppError.badRequest(ErrorCode.amountMismatch, 'Payment amount does not match the deposit');
      }

      if (payload.resultCode !== 0) {
        if (deposit.status === 'PENDING') {
          await tx
            .update(deposits)
            .set({ status: 'FAILED', completedAt: this.clock.now() })
            .where(eq(deposits.id, deposit.id));
        }
        return { handled: true };
      }

      await this.creditDeposit(tx, deposit.id, {
        providerTxnId: payload.transId ?? `MOMO-${deposit.id}`,
      });
      return { handled: true };
    });
  }

  private async creditDeposit(
    tx: DbExecutor,
    depositId: string,
    options: { userId?: string; providerTxnId: string },
  ): Promise<typeof deposits.$inferSelect> {
    const [deposit] = await tx.select().from(deposits).where(eq(deposits.id, depositId)).for('update');

    if (!deposit || (options.userId && deposit.userId !== options.userId)) {
      throw AppError.notFound(ErrorCode.notFound, 'Deposit not found');
    }
    if (deposit.status === 'SUCCEEDED') return deposit;
    if (deposit.status === 'FAILED') {
      throw AppError.conflict(ErrorCode.depositAlreadySettled, 'This deposit has already failed');
    }

    const now = this.clock.now();
    await this.addToAvailable(tx, deposit.walletId, deposit.amount);

    const [updated] = await tx
      .update(deposits)
      .set({ status: 'SUCCEEDED', providerTxnId: options.providerTxnId, completedAt: now })
      .where(eq(deposits.id, deposit.id))
      .returning();

    await this.post(tx, [
      {
        accountType: 'EXTERNAL',
        accountId: null,
        direction: 'DEBIT',
        type: 'DEPOSIT',
        amount: deposit.amount,
        note: LEDGER_NOTES.deposit,
      },
      {
        accountType: 'USER',
        accountId: deposit.userId,
        walletId: deposit.walletId,
        direction: 'CREDIT',
        type: 'DEPOSIT',
        amount: deposit.amount,
        note: LEDGER_NOTES.deposit,
      },
    ]);

    return updated;
  }

  async requestWithdrawal(userId: string, dto: RequestWithdrawalDto): Promise<{ id: string; status: string }> {
    assertPositiveVnd(dto.amount, 'amount');

    return this.db.transaction(async (tx) => {
      const wallet = await this.getOrCreateWallet(tx, userId);

      const [pending] = await tx
        .select({ id: withdrawals.id })
        .from(withdrawals)
        .where(and(eq(withdrawals.userId, userId), eq(withdrawals.status, 'PENDING')))
        .limit(1);

      if (pending) {
        throw AppError.conflict(
          ErrorCode.pendingWithdrawalExists,
          'You already have a pending withdrawal; wait for it to be processed',
        );
      }

      if ((await this.tryDebitAvailable(tx, wallet.id, dto.amount)) === null) {
        throw AppError.badRequest(
          ErrorCode.insufficientBalance,
          'Your available balance is lower than the requested withdrawal amount',
        );
      }

      const [row] = await tx
        .insert(withdrawals)
        .values({ userId, walletId: wallet.id, amount: dto.amount, provider: 'MOMO', note: dto.note ?? null })
        .returning();

      await this.post(tx, [
        {
          accountType: 'USER',
          accountId: userId,
          walletId: wallet.id,
          direction: 'DEBIT',
          type: 'WITHDRAWAL',
          amount: dto.amount,
          note: dto.note ?? LEDGER_NOTES.withdrawalRequest,
        },
        {
          accountType: 'EXTERNAL',
          accountId: null,
          direction: 'CREDIT',
          type: 'WITHDRAWAL',
          amount: dto.amount,
          note: dto.note ?? LEDGER_NOTES.withdrawalRequest,
        },
      ]);

      return { id: row.id, status: row.status };
    });
  }

  async adminListWithdrawals(query: ListWithdrawalsQuery): Promise<Paginated<WithdrawalView>> {
    const where = query.status ? eq(withdrawals.status, query.status) : undefined;

    const [rows, [total]] = await Promise.all([
      this.db
        .select({ withdrawal: withdrawals, user: users })
        .from(withdrawals)
        .innerJoin(users, eq(users.id, withdrawals.userId))
        .where(where)
        .orderBy(desc(withdrawals.createdAt), desc(withdrawals.id))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(withdrawals).where(where),
    ]);

    return paginated(
      rows.map(({ withdrawal, user }) => ({
        id: withdrawal.id,
        amount: withdrawal.amount,
        status: withdrawal.status,
        note: withdrawal.note,
        createdAt: withdrawal.createdAt.toISOString(),
        processedAt: withdrawal.processedAt?.toISOString() ?? null,
        user: { id: user.id, name: user.name, email: user.email },
      })),
      total?.value ?? 0,
      query.page,
      query.pageSize,
    );
  }

  async resolveWithdrawal(
    id: string,
    status: 'PAID' | 'REJECTED',
    note: string,
    admin: AuthUser,
  ): Promise<WithdrawalResolutionDto> {
    return this.db.transaction(async (tx) => {
      const [withdrawal] = await tx.select().from(withdrawals).where(eq(withdrawals.id, id)).for('update');
      if (!withdrawal) throw AppError.notFound(ErrorCode.withdrawalNotFound, 'Withdrawal not found');
      if (withdrawal.status !== 'PENDING') {
        throw AppError.conflict(ErrorCode.alreadyResolved, 'This withdrawal has already been processed');
      }

      const now = this.clock.now();
      let outcome: WithdrawalResolutionDto;

      if (status === 'PAID') {
        const [updated] = await tx
          .update(withdrawals)
          .set({
            status: 'PAID',
            note,
            processedAt: now,
            processedBy: admin.id,
          })
          .where(eq(withdrawals.id, id))
          .returning();
        outcome = { id: updated.id, status: updated.status };
      } else {
        await this.refundWithdrawal(tx, withdrawal, 'REJECTED', note, now, admin.id);
        outcome = { id: withdrawal.id, status: 'REJECTED' };
      }

      // Inside the transaction: a payout that moved without an audit row, or an
      // audit row for a payout that rolled back, are both worse than a retry.
      await this.audit.log(tx, {
        adminId: admin.id,
        adminRole: admin.adminRole,
        action: AUDIT_ACTIONS.withdrawalResolve,
        entity: 'withdrawal',
        entityId: withdrawal.id,
        reason: note,
        detail: { decision: status, amount: withdrawal.amount, userId: withdrawal.userId },
      });

      return outcome;
    });
  }

  async cancelWithdrawal(userId: string, id: string): Promise<{ id: string; status: string }> {
    return this.db.transaction(async (tx) => {
      const [withdrawal] = await tx.select().from(withdrawals).where(eq(withdrawals.id, id)).for('update');
      if (!withdrawal || withdrawal.userId !== userId) {
        throw AppError.notFound(ErrorCode.withdrawalNotFound, 'Withdrawal not found');
      }
      if (withdrawal.status !== 'PENDING') {
        throw AppError.conflict(ErrorCode.alreadyResolved, 'Only pending withdrawals can be cancelled');
      }

      await this.refundWithdrawal(tx, withdrawal, 'CANCELLED', 'Người dùng tự huỷ yêu cầu', this.clock.now());
      return { id: withdrawal.id, status: 'CANCELLED' };
    });
  }

  private async refundWithdrawal(
    tx: DbExecutor,
    withdrawal: typeof withdrawals.$inferSelect,
    status: 'REJECTED' | 'CANCELLED',
    note: string | undefined,
    now: Date,
    /** Absent when the user cancelled it themselves. */
    processedBy?: string,
  ): Promise<void> {
    await this.addToAvailable(tx, withdrawal.walletId, withdrawal.amount);

    await tx
      .update(withdrawals)
      .set({ status, note: note ?? withdrawal.note, processedAt: now, processedBy: processedBy ?? null })
      .where(eq(withdrawals.id, withdrawal.id));

    await this.post(tx, [
      {
        accountType: 'EXTERNAL',
        accountId: null,
        direction: 'DEBIT',
        type: 'ADJUSTMENT',
        amount: withdrawal.amount,
        note: status === 'REJECTED' ? LEDGER_NOTES.withdrawalRejected : LEDGER_NOTES.withdrawalCancelled,
      },
      {
        accountType: 'USER',
        accountId: withdrawal.userId,
        walletId: withdrawal.walletId,
        direction: 'CREDIT',
        type: 'ADJUSTMENT',
        amount: withdrawal.amount,
        note: status === 'REJECTED' ? LEDGER_NOTES.withdrawalRejected : LEDGER_NOTES.withdrawalCancelled,
      },
    ]);
  }

  /** Moves hirer funds into escrow and records the double-entry ledger rows. */
  async holdEscrow(
    tx: DbExecutor,
    input: { orderId: string; hirerId: string; amount: number },
  ): Promise<{ holdId: string; walletId: string }> {
    assertPositiveVnd(input.amount, 'escrow amount');

    const wallet = await this.getOrCreateWallet(tx, input.hirerId);
    if ((await this.tryDebitAvailable(tx, wallet.id, input.amount)) === null) {
      throw AppError.badRequest(
        ErrorCode.insufficientBalance,
        'Your available balance cannot cover this order any more; top up and try again',
      );
    }

    const [hold] = await tx
      .insert(escrowHolds)
      .values({ orderId: input.orderId, hirerWalletId: wallet.id, amount: input.amount })
      .returning();

    await this.post(tx, [
      {
        accountType: 'USER',
        accountId: input.hirerId,
        walletId: wallet.id,
        orderId: input.orderId,
        direction: 'DEBIT',
        type: 'ESCROW_HOLD',
        amount: input.amount,
        note: LEDGER_NOTES.escrowHold,
      },
      {
        accountType: 'ESCROW',
        accountId: input.orderId,
        orderId: input.orderId,
        direction: 'CREDIT',
        type: 'ESCROW_HOLD',
        amount: input.amount,
        note: LEDGER_NOTES.escrowHold,
      },
    ]);

    return { holdId: hold.id, walletId: wallet.id };
  }

  async findHold(tx: DbExecutor, orderId: string): Promise<typeof escrowHolds.$inferSelect> {
    const [hold] = await tx
      .select()
      .from(escrowHolds)
      .where(eq(escrowHolds.orderId, orderId))
      .for('update');
    if (!hold) throw AppError.notFound(ErrorCode.orderNotFound, 'Escrow hold not found for this order');
    return hold;
  }

  /**
   * Releases (part of) an escrow hold: the earned amount is split into the
   * player's pending balance and the platform fee, everything else is refunded.
   */
  async settleEscrow(
    tx: DbExecutor,
    input: {
      orderId: string;
      hirerId: string;
      playerId: string | null;
      earned: number;
      feeBps: number;
      releaseHours: number;
    },
  ): Promise<SettlementResult> {
    if (!Number.isSafeInteger(input.earned) || input.earned < 0) {
      throw new Error('earned must be a non-negative integer');
    }

    const hold = await this.findHold(tx, input.orderId);
    if (hold.status !== 'HELD') {
      throw AppError.conflict(ErrorCode.invalidOrderState, 'Escrow for this order has already been settled');
    }
    if (input.earned > hold.amount) {
      throw AppError.badRequest(ErrorCode.validationFailed, 'Settled amount exceeds the escrow hold');
    }

    const refund = hold.amount - input.earned;
    const { fee, payout } = splitFee(input.earned, input.feeBps);
    const now = this.clock.now();

    let pendingCreditId: string | null = null;

    if (refund > 0) {
      const hirerWallet = await this.getOrCreateWallet(tx, input.hirerId);
      await this.addToAvailable(tx, hirerWallet.id, refund);

      await this.post(tx, [
        {
          accountType: 'ESCROW',
          accountId: input.orderId,
          orderId: input.orderId,
          direction: 'DEBIT',
          type: 'ESCROW_REFUND',
          amount: refund,
          note: LEDGER_NOTES.escrowRefund,
        },
        {
          accountType: 'USER',
          accountId: input.hirerId,
          walletId: hirerWallet.id,
          orderId: input.orderId,
          direction: 'CREDIT',
          type: 'ESCROW_REFUND',
          amount: refund,
          note: LEDGER_NOTES.escrowRefund,
        },
      ]);
    }

    if (input.earned > 0 && input.playerId) {
      const playerWallet = await this.getOrCreateWallet(tx, input.playerId);

      const [credit] = await tx
        .insert(pendingCredits)
        .values({
          walletId: playerWallet.id,
          orderId: input.orderId,
          amount: payout,
          availableAt: addHours(now, input.releaseHours),
        })
        .returning();

      pendingCreditId = credit.id;

      await this.post(tx, [
        {
          accountType: 'ESCROW',
          accountId: input.orderId,
          orderId: input.orderId,
          direction: 'DEBIT',
          type: 'ESCROW_RELEASE',
          amount: input.earned,
          note: LEDGER_NOTES.escrowReleased,
        },
        {
          accountType: 'USER',
          accountId: input.playerId,
          walletId: playerWallet.id,
          orderId: input.orderId,
          direction: 'CREDIT',
          type: 'ORDER_EARNING',
          amount: payout,
          note: LEDGER_NOTES.orderEarning,
        },
        ...(fee > 0
          ? [
              {
                accountType: 'PLATFORM' as const,
                accountId: null,
                orderId: input.orderId,
                direction: 'CREDIT' as const,
                type: 'PLATFORM_FEE' as const,
                amount: fee,
                note: LEDGER_NOTES.platformFee,
              },
            ]
          : []),
      ]);
    }

    const status: SettlementResult['status'] =
      input.earned === 0 ? 'REFUNDED' : refund === 0 ? 'SETTLED' : 'PARTIALLY_SETTLED';

    await tx
      .update(escrowHolds)
      .set({ status, settledAmount: input.earned, refundedAmount: refund, updatedAt: now })
      .where(eq(escrowHolds.id, hold.id));

    return { fee, payout, refund, status, pendingCreditId };
  }

  async refundEscrow(tx: DbExecutor, input: { orderId: string; hirerId: string }): Promise<SettlementResult> {
    return this.settleEscrow(tx, {
      orderId: input.orderId,
      hirerId: input.hirerId,
      playerId: null,
      earned: 0,
      feeBps: 0,
      releaseHours: 0,
    });
  }

  /**
   * Claws back part of an order's earnings from a player to refund a hirer.
   * Un-released earnings are taken first, then the available balance; any
   * shortfall is absorbed by the platform so the hirer always receives the full
   * refund.
   *
   * The ceiling is the payout the player received for this order *minus every
   * refund already paid out on it*. Checking per-request instead of cumulative
   * would let a second upheld report refund the same money again.
   */
  async refundFromPlayerToHirer(
    tx: DbExecutor,
    input: { orderId: string; playerId: string; hirerId: string; amount: number },
  ): Promise<{ fromPending: number; fromAvailable: number; fromPlatform: number }> {
    assertPositiveVnd(input.amount, 'refund amount');

    // Locking the hold is what makes the cumulative check trustworthy: two
    // reports resolved at the same moment would otherwise both read the same
    // already-refunded total and both pass.
    const hold = await this.findHold(tx, input.orderId);
    const [order] = await tx
      .select({ playerPayout: orders.playerPayout })
      .from(orders)
      .where(eq(orders.id, hold.orderId))
      .limit(1);
    if (!order) throw AppError.notFound(ErrorCode.orderNotFound, 'Order not found');

    const alreadyRefunded = await this.reportRefundedTotal(tx, hold.orderId);
    const refundable = (order.playerPayout ?? 0) - alreadyRefunded;
    if (input.amount > refundable) {
      throw AppError.unprocessable(
        ErrorCode.refundExceedsPayout,
        `Only ${refundable} VND of this order is still refundable; ${alreadyRefunded} VND has already been refunded`,
        { playerPayout: order.playerPayout ?? 0, alreadyRefunded, refundable },
      );
    }

    const playerWallet = await this.lockWallet(tx, input.playerId);

    // Pending money is a set of credit rows, not a number, so clawing back has
    // to shrink those rows. Reducing a balance instead — which is what this did
    // — left the credit standing; the release job later found nothing to move,
    // clamped it to zero and still stamped `releasedAt`, so the earnings
    // disappeared with no ledger row to show for it.
    let remaining = input.amount;
    const openCredits = await tx
      .select({ id: pendingCredits.id, amount: pendingCredits.amount })
      .from(pendingCredits)
      .where(and(eq(pendingCredits.walletId, playerWallet.id), isNull(pendingCredits.releasedAt)))
      .orderBy(asc(pendingCredits.availableAt));

    for (const credit of openCredits) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, credit.amount);
      if (take === credit.amount) {
        await tx.delete(pendingCredits).where(eq(pendingCredits.id, credit.id));
      } else {
        await tx
          .update(pendingCredits)
          .set({ amount: credit.amount - take })
          .where(eq(pendingCredits.id, credit.id));
      }
      remaining -= take;
    }
    const fromPending = input.amount - remaining;

    const fromAvailable = Math.min(remaining, playerWallet.availableBalance);
    if (fromAvailable > 0) {
      await this.debitLocked(tx, playerWallet.id, fromAvailable);
      remaining -= fromAvailable;
    }
    const fromPlatform = remaining;
    const playerTotal = fromPending + fromAvailable;

    if (playerTotal > 0) {
      await this.post(tx, [
        {
          accountType: 'USER',
          accountId: input.playerId,
          walletId: playerWallet.id,
          orderId: input.orderId,
          direction: 'DEBIT',
          type: 'ADJUSTMENT',
          amount: playerTotal,
          note: LEDGER_NOTES.reportRefund,
        },
        {
          accountType: 'PLATFORM',
          accountId: null,
          orderId: input.orderId,
          direction: 'CREDIT',
          type: 'ADJUSTMENT',
          amount: playerTotal,
          note: LEDGER_NOTES.reportClawback,
        },
      ]);
    }

    const hirerWallet = await this.getOrCreateWallet(tx, input.hirerId);
    await this.addToAvailable(tx, hirerWallet.id, input.amount);

    await this.post(tx, [
      {
        accountType: 'PLATFORM',
        accountId: null,
        orderId: input.orderId,
        direction: 'DEBIT',
        type: 'REPORT_REFUND',
        amount: input.amount,
        note: LEDGER_NOTES.reportCompensation,
      },
      {
        accountType: 'USER',
        accountId: input.hirerId,
        walletId: hirerWallet.id,
        orderId: input.orderId,
        direction: 'CREDIT',
        type: 'REPORT_REFUND',
        amount: input.amount,
        note: LEDGER_NOTES.reportCompensation,
      },
    ]);

    return { fromPending, fromAvailable, fromPlatform };
  }

  /** Sum of every report refund already credited to a hirer for one order. */
  private async reportRefundedTotal(tx: DbExecutor, orderId: string): Promise<number> {
    const [row] = await tx
      .select({
        total: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)::bigint`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.orderId, orderId),
          eq(ledgerEntries.type, 'REPORT_REFUND'),
          eq(ledgerEntries.direction, 'CREDIT'),
        ),
      );
    return Number(row?.total ?? 0);
  }

  /**
   * Moves earnings whose hold period has elapsed into the available balance.
   *
   * Wallets are locked before their credits, which is the order the report
   * claw-back uses too; going credit-then-wallet here would have had the two
   * paths deadlocking around the same rows. It also writes each wallet once
   * instead of once per credit.
   */
  async releaseDuePendingCredits(walletId?: string): Promise<number> {
    const now = this.clock.now();
    const dueFilters = [
      isNull(pendingCredits.releasedAt),
      lte(pendingCredits.availableAt, now),
      ...(walletId ? [eq(pendingCredits.walletId, walletId)] : []),
    ];

    const dueWallets = await this.db
      .selectDistinct({ walletId: pendingCredits.walletId })
      .from(pendingCredits)
      .where(and(...dueFilters));

    let released = 0;

    for (const { walletId: id } of dueWallets) {
      released += await this.db.transaction(async (tx) => {
        const [wallet] = await tx.select().from(wallets).where(eq(wallets.id, id)).for('update');
        if (!wallet) return 0;

        const due = await tx
          .select({ id: pendingCredits.id, amount: pendingCredits.amount })
          .from(pendingCredits)
          .where(
            and(
              eq(pendingCredits.walletId, id),
              isNull(pendingCredits.releasedAt),
              lte(pendingCredits.availableAt, now),
            ),
          )
          .for('update');

        if (due.length === 0) return 0;

        await this.addToAvailable(tx, id, due.reduce((sum, credit) => sum + credit.amount, 0));
        await tx
          .update(pendingCredits)
          .set({ releasedAt: now })
          .where(inArray(pendingCredits.id, due.map((credit) => credit.id)));

        return due.length;
      });
    }

    return released;
  }

  /** Platform overview: total money currently held in escrow. */
  async escrowTotal(): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<number>`coalesce(sum(${escrowHolds.amount} - ${escrowHolds.settledAmount} - ${escrowHolds.refundedAmount}), 0)` })
      .from(escrowHolds)
      .where(eq(escrowHolds.status, 'HELD'));
    return Number(row?.value ?? 0);
  }
}
