import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DB, type AppDatabase, type DbExecutor } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { assertPositiveVnd, splitFee } from '../../common/money/money';
import { offsetOf, paginated, type Paginated } from '../../common/pagination/pagination';
import { addHours, Clock } from '../../common/time/time';
import {
  deposits,
  escrowHolds,
  ledgerEntries,
  pendingCredits,
  users,
  wallets,
  withdrawals,
  type Wallet,
} from '../../db/schema';
import { MomoAdapter } from './momo.adapter';
import type {
  ListTransactionsQuery,
  ListWithdrawalsQuery,
  MomoIpnDto,
  MyWithdrawalView,
  RequestWithdrawalDto,
  WalletSummary,
  WithdrawalResolutionDto,
  WithdrawalView,
} from './wallet.dto';

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
      pendingBalance: wallet.pendingBalance,
      pendingCredits: credits.map((credit) => ({
        id: credit.id,
        orderId: credit.orderId,
        amount: credit.amount,
        availableAt: credit.availableAt.toISOString(),
      })),
    };
  }

  async listTransactions(userId: string, query: ListTransactionsQuery): Promise<Paginated<unknown>> {
    const wallet = await this.getOrCreateWallet(this.db, userId);
    const where = query.type
      ? and(eq(ledgerEntries.walletId, wallet.id), eq(ledgerEntries.type, query.type))
      : eq(ledgerEntries.walletId, wallet.id);

    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(ledgerEntries)
        .where(where)
        .orderBy(desc(ledgerEntries.createdAt))
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
        .orderBy(desc(deposits.createdAt))
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
        .orderBy(desc(withdrawals.createdAt))
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
      await this.db.delete(deposits).where(eq(deposits.id, deposit.id));
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
      throw AppError.conflict(ErrorCode.invalidOrderState, 'This deposit has already failed');
    }

    const [wallet] = await tx.select().from(wallets).where(eq(wallets.id, deposit.walletId)).for('update');
    const now = this.clock.now();

    await tx
      .update(wallets)
      .set({ availableBalance: wallet.availableBalance + deposit.amount, updatedAt: now })
      .where(eq(wallets.id, wallet.id));

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
        note: 'Top-up via MoMo',
      },
      {
        accountType: 'USER',
        accountId: deposit.userId,
        walletId: wallet.id,
        direction: 'CREDIT',
        type: 'DEPOSIT',
        amount: deposit.amount,
        note: 'Top-up via MoMo',
      },
    ]);

    return updated;
  }

  async requestWithdrawal(userId: string, dto: RequestWithdrawalDto): Promise<{ id: string; status: string }> {
    assertPositiveVnd(dto.amount, 'amount');

    return this.db.transaction(async (tx) => {
      const wallet = await this.lockWallet(tx, userId);
      if (wallet.availableBalance < dto.amount) {
        throw AppError.badRequest(
          ErrorCode.insufficientBalance,
          'Your available balance is lower than the requested withdrawal amount',
        );
      }

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

      const [row] = await tx
        .insert(withdrawals)
        .values({ userId, walletId: wallet.id, amount: dto.amount, provider: 'MOMO', note: dto.note ?? null })
        .returning();

      await tx
        .update(wallets)
        .set({ availableBalance: wallet.availableBalance - dto.amount, updatedAt: this.clock.now() })
        .where(eq(wallets.id, wallet.id));

      await this.post(tx, [
        {
          accountType: 'USER',
          accountId: userId,
          walletId: wallet.id,
          direction: 'DEBIT',
          type: 'WITHDRAWAL',
          amount: dto.amount,
          note: dto.note ?? 'Withdrawal request',
        },
        {
          accountType: 'EXTERNAL',
          accountId: null,
          direction: 'CREDIT',
          type: 'WITHDRAWAL',
          amount: dto.amount,
          note: dto.note ?? 'Withdrawal request',
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
        .orderBy(desc(withdrawals.createdAt))
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
    note?: string,
  ): Promise<WithdrawalResolutionDto> {
    return this.db.transaction(async (tx) => {
      const [withdrawal] = await tx.select().from(withdrawals).where(eq(withdrawals.id, id)).for('update');
      if (!withdrawal) throw AppError.notFound(ErrorCode.withdrawalNotFound, 'Withdrawal not found');
      if (withdrawal.status !== 'PENDING') {
        throw AppError.conflict(ErrorCode.alreadyResolved, 'This withdrawal has already been processed');
      }

      const now = this.clock.now();

      if (status === 'PAID') {
        const [updated] = await tx
          .update(withdrawals)
          .set({ status: 'PAID', note: note ?? withdrawal.note, processedAt: now })
          .where(eq(withdrawals.id, id))
          .returning();
        return { id: updated.id, status: updated.status };
      }

      await this.refundWithdrawal(tx, withdrawal, 'REJECTED', note, now);
      return { id: withdrawal.id, status: 'REJECTED' };
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

      await this.refundWithdrawal(tx, withdrawal, 'CANCELLED', 'Cancelled by user', this.clock.now());
      return { id: withdrawal.id, status: 'CANCELLED' };
    });
  }

  private async refundWithdrawal(
    tx: DbExecutor,
    withdrawal: typeof withdrawals.$inferSelect,
    status: 'REJECTED' | 'CANCELLED',
    note: string | undefined,
    now: Date,
  ): Promise<void> {
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.id, withdrawal.walletId)).for('update');

    await tx
      .update(wallets)
      .set({ availableBalance: wallet.availableBalance + withdrawal.amount, updatedAt: now })
      .where(eq(wallets.id, wallet.id));

    await tx
      .update(withdrawals)
      .set({ status, note: note ?? withdrawal.note, processedAt: now })
      .where(eq(withdrawals.id, withdrawal.id));

    await this.post(tx, [
      {
        accountType: 'EXTERNAL',
        accountId: null,
        direction: 'DEBIT',
        type: 'ADJUSTMENT',
        amount: withdrawal.amount,
        note: `Withdrawal ${status.toLowerCase()}`,
      },
      {
        accountType: 'USER',
        accountId: withdrawal.userId,
        walletId: wallet.id,
        direction: 'CREDIT',
        type: 'ADJUSTMENT',
        amount: withdrawal.amount,
        note: `Withdrawal ${status.toLowerCase()}`,
      },
    ]);
  }

  /** Moves hirer funds into escrow and records the double-entry ledger rows. */
  async holdEscrow(
    tx: DbExecutor,
    input: { orderId: string; hirerId: string; amount: number },
  ): Promise<{ holdId: string; walletId: string }> {
    assertPositiveVnd(input.amount, 'escrow amount');

    const wallet = await this.lockWallet(tx, input.hirerId);
    if (wallet.availableBalance < input.amount) {
      throw AppError.badRequest(
        ErrorCode.insufficientBalance,
        'Your available balance cannot cover this order any more; top up and try again',
      );
    }

    await tx
      .update(wallets)
      .set({ availableBalance: wallet.availableBalance - input.amount, updatedAt: this.clock.now() })
      .where(eq(wallets.id, wallet.id));

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
        note: 'Funds held for order',
      },
      {
        accountType: 'ESCROW',
        accountId: input.orderId,
        orderId: input.orderId,
        direction: 'CREDIT',
        type: 'ESCROW_HOLD',
        amount: input.amount,
        note: 'Funds held for order',
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
      const hirerWallet = await this.lockWallet(tx, input.hirerId);
      await tx
        .update(wallets)
        .set({ availableBalance: hirerWallet.availableBalance + refund, updatedAt: now })
        .where(eq(wallets.id, hirerWallet.id));

      await this.post(tx, [
        {
          accountType: 'ESCROW',
          accountId: input.orderId,
          orderId: input.orderId,
          direction: 'DEBIT',
          type: 'ESCROW_REFUND',
          amount: refund,
          note: 'Unused escrow refunded to hirer',
        },
        {
          accountType: 'USER',
          accountId: input.hirerId,
          walletId: hirerWallet.id,
          orderId: input.orderId,
          direction: 'CREDIT',
          type: 'ESCROW_REFUND',
          amount: refund,
          note: 'Unused escrow refunded to hirer',
        },
      ]);
    }

    if (input.earned > 0 && input.playerId) {
      const playerWallet = await this.lockWallet(tx, input.playerId);
      await tx
        .update(wallets)
        .set({ pendingBalance: playerWallet.pendingBalance + payout, updatedAt: now })
        .where(eq(wallets.id, playerWallet.id));

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
          note: 'Escrow released',
        },
        {
          accountType: 'USER',
          accountId: input.playerId,
          walletId: playerWallet.id,
          orderId: input.orderId,
          direction: 'CREDIT',
          type: 'ORDER_EARNING',
          amount: payout,
          note: 'Order earnings (pending release)',
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
                note: 'Platform commission',
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
   * Pending balance is used first, then available balance; any shortfall is
   * absorbed by the platform so the hirer always receives the full refund.
   */
  async refundFromPlayerToHirer(
    tx: DbExecutor,
    input: { orderId: string; playerId: string; hirerId: string; amount: number },
  ): Promise<{ fromPending: number; fromAvailable: number; fromPlatform: number }> {
    assertPositiveVnd(input.amount, 'refund amount');

    const playerWallet = await this.lockWallet(tx, input.playerId);
    const fromPending = Math.min(input.amount, playerWallet.pendingBalance);
    const remainingAfterPending = input.amount - fromPending;
    const fromAvailable = Math.min(remainingAfterPending, playerWallet.availableBalance);
    const fromPlatform = input.amount - fromPending - fromAvailable;
    const playerTotal = fromPending + fromAvailable;
    const now = this.clock.now();

    await tx
      .update(wallets)
      .set({
        pendingBalance: playerWallet.pendingBalance - fromPending,
        availableBalance: playerWallet.availableBalance - fromAvailable,
        updatedAt: now,
      })
      .where(eq(wallets.id, playerWallet.id));

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
          note: 'Refund to hirer after upheld report',
        },
        {
          accountType: 'PLATFORM',
          accountId: null,
          orderId: input.orderId,
          direction: 'CREDIT',
          type: 'ADJUSTMENT',
          amount: playerTotal,
          note: 'Claw-back from player',
        },
      ]);
    }

    const hirerWallet = await this.lockWallet(tx, input.hirerId);
    await tx
      .update(wallets)
      .set({ availableBalance: hirerWallet.availableBalance + input.amount, updatedAt: now })
      .where(eq(wallets.id, hirerWallet.id));

    await this.post(tx, [
      {
        accountType: 'PLATFORM',
        accountId: null,
        orderId: input.orderId,
        direction: 'DEBIT',
        type: 'REPORT_REFUND',
        amount: input.amount,
        note: 'Report compensation to hirer',
      },
      {
        accountType: 'USER',
        accountId: input.hirerId,
        walletId: hirerWallet.id,
        orderId: input.orderId,
        direction: 'CREDIT',
        type: 'REPORT_REFUND',
        amount: input.amount,
        note: 'Report compensation to hirer',
      },
    ]);

    return { fromPending, fromAvailable, fromPlatform };
  }

  /** Releases pending earnings whose hold period has elapsed. */
  async releaseDuePendingCredits(): Promise<number> {
    const now = this.clock.now();
    const due = await this.db
      .select()
      .from(pendingCredits)
      .where(and(isNull(pendingCredits.releasedAt), lte(pendingCredits.availableAt, now)))
      .limit(200);

    let released = 0;

    for (const credit of due) {
      const didRelease = await this.db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(pendingCredits)
          .where(eq(pendingCredits.id, credit.id))
          .for('update');

        if (!locked || locked.releasedAt) return false;

        const [wallet] = await tx.select().from(wallets).where(eq(wallets.id, locked.walletId)).for('update');
        const amount = Math.min(locked.amount, wallet.pendingBalance);

        if (amount > 0) {
          await tx
            .update(wallets)
            .set({
              pendingBalance: wallet.pendingBalance - amount,
              availableBalance: wallet.availableBalance + amount,
              updatedAt: this.clock.now(),
            })
            .where(eq(wallets.id, wallet.id));
        }

        await tx
          .update(pendingCredits)
          .set({ releasedAt: this.clock.now() })
          .where(eq(pendingCredits.id, locked.id));

        return amount > 0;
      });

      if (didRelease) released += 1;
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
