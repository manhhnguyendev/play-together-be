import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { DB, type AppDatabase } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { MIN_DONATION, MIN_WITHDRAWAL } from '../../common/money/money';
import { offsetOf, paginated, type PageQueryDto, type Paginated } from '../../common/pagination/pagination';
import { PasswordService } from '../../common/security/password.service';
import { TokenService } from '../../common/security/token.service';
import { Clock } from '../../common/time/time';
import { charities, charityWithdrawals, donations, users, wallets, type Charity } from '../../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletService } from '../wallet/wallet.service';
import type {
  CharityStats,
  CharityView,
  CharityWithdrawalView,
  CreateCharityAccountDto,
  DonationView,
  ListAdminCharitiesQuery,
  ListCharitiesQuery,
  ListCharityWithdrawalsQuery,
  ListDonationsQuery,
  ResolveCharityWithdrawalDto,
  UpdateCharityAsAdminDto,
  UpdateCharityDto,
} from './charity.dto';

const EMPTY_STATS: CharityStats = { raised: 0, donations: 0, donors: 0 };

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
}

@Injectable()
export class CharityService {
  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly wallet: WalletService,
    private readonly notifications: NotificationsService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly clock: Clock,
  ) {}

  async list(query: ListCharitiesQuery): Promise<Paginated<CharityView>> {
    const pattern = query.q ? `%${query.q}%` : null;
    const where = pattern
      ? and(eq(charities.isActive, true), or(ilike(charities.organizationName, pattern), ilike(charities.information, pattern)))
      : eq(charities.isActive, true);

    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(charities)
        .where(where)
        .orderBy(desc(charities.createdAt))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(charities).where(where),
    ]);

    const stats = await this.statsFor(rows.map((row) => row.id));

    return paginated(
      rows.map((row) => this.map(row, stats.get(row.id) ?? EMPTY_STATS, null)),
      total?.value ?? 0,
      query.page,
      query.pageSize,
    );
  }

  async get(
    charityId: string,
    viewer?: { id: string; role: string },
  ): Promise<CharityView> {
    const [row] = await this.db
      .select({
        charity: charities,
        accountId: users.id,
        accountEmail: users.email,
      })
      .from(charities)
      .innerJoin(users, eq(users.id, charities.userId))
      .where(eq(charities.id, charityId))
      .limit(1);

    if (!row) throw AppError.notFound(ErrorCode.charityNotFound, 'Charity not found');

    const privileged = viewer?.role === 'ADMIN' || row.charity.userId === viewer?.id;
    if (!row.charity.isActive && !privileged) {
      throw AppError.notFound(ErrorCode.charityNotFound, 'Charity not found');
    }

    const stats = await this.statsFor([row.charity.id]);
    return this.map(
      row.charity,
      stats.get(row.charity.id) ?? EMPTY_STATS,
      privileged ? { id: row.accountId, email: row.accountEmail } : null,
    );
  }

  async byUser(userId: string): Promise<CharityView> {
    const charity = await this.requireByUser(userId);
    return this.get(charity.id, { id: userId, role: 'CHARITY' });
  }

  async donate(
    donor: { id: string; role: string },
    charityId: string,
    amount: number,
    message?: string,
  ): Promise<{ donationId: string; charityId: string; amount: number }> {
    if (donor.role !== 'USER') {
      throw AppError.forbidden(ErrorCode.forbidden, 'Only hirer accounts can donate');
    }
    if (!Number.isSafeInteger(amount) || amount < MIN_DONATION) {
      throw AppError.badRequest(ErrorCode.donationTooSmall, `The minimum donation is ${MIN_DONATION} VND`);
    }

    const [donorRow] = await this.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, donor.id))
      .limit(1);
    if (!donorRow) throw AppError.notFound(ErrorCode.userNotFound, 'Donor not found');

    return this.db.transaction(async (tx) => {
      const [charity] = await tx.select().from(charities).where(eq(charities.id, charityId)).for('update');
      if (!charity) throw AppError.notFound(ErrorCode.charityNotFound, 'Charity not found');
      if (!charity.isActive) throw AppError.conflict(ErrorCode.charityInactive, 'This charity is not accepting donations');

      const wallet = await this.wallet.lockWallet(tx, donor.id);
      if (wallet.availableBalance < amount) {
        throw AppError.unprocessable(
          ErrorCode.insufficientBalance,
          `Your available balance (${wallet.availableBalance} VND) is not enough for this donation`,
        );
      }

      const now = this.clock.now();
      await tx
        .update(wallets)
        .set({ availableBalance: wallet.availableBalance - amount, updatedAt: now })
        .where(eq(wallets.id, wallet.id));
      await tx
        .update(charities)
        .set({ balance: charity.balance + amount, updatedAt: now })
        .where(eq(charities.id, charity.id));

      const [donation] = await tx
        .insert(donations)
        .values({ donorId: donor.id, charityId: charity.id, amount, message: message ?? null })
        .returning();

      await this.wallet.post(tx, [
        {
          accountType: 'USER',
          accountId: donor.id,
          walletId: wallet.id,
          direction: 'DEBIT',
          type: 'DONATION',
          amount,
          note: `Donation to ${charity.organizationName}`,
        },
        {
          accountType: 'CHARITY',
          accountId: charity.userId,
          charityId: charity.id,
          direction: 'CREDIT',
          type: 'DONATION',
          amount,
          note: `Donation from ${donorRow.name}`,
        },
      ]);

      await this.notifications.send(tx, {
        userId: charity.userId,
        title: 'New donation received',
        body: `${donorRow.name} donated ${amount} VND${message ? ` — ${message}` : ''}`,
        referenceUrl: `/charities/${charity.id}`,
      });

      return { donationId: donation.id, charityId: charity.id, amount };
    });
  }

  async myDonations(donorId: string, query: ListDonationsQuery): Promise<Paginated<DonationView>> {
    return this.listDonations(eq(donations.donorId, donorId), query);
  }

  async receivedDonations(userId: string, query: ListDonationsQuery) {
    const charity = await this.requireByUser(userId);
    return this.listDonations(eq(donations.charityId, charity.id), query);
  }

  async donationsForCharity(charityId: string, viewer: { id: string; role: string }, query: ListDonationsQuery) {
    await this.get(charityId, viewer);
    return this.listDonations(eq(donations.charityId, charityId), query);
  }

  async updateProfile(userId: string, dto: UpdateCharityDto): Promise<CharityView> {
    const charity = await this.requireByUser(userId);

    await this.db.transaction(async (tx) => {
      await tx
        .update(charities)
        .set({
          organizationName: dto.organizationName ?? charity.organizationName,
          information: dto.information ?? charity.information,
          address: dto.address ?? charity.address,
          email: dto.contactEmail ?? charity.email,
          phone: dto.phone ?? charity.phone,
          avatarUrl: dto.avatarUrl ?? charity.avatarUrl,
          updatedAt: this.clock.now(),
        })
        .where(eq(charities.id, charity.id));

      await tx
        .update(users)
        .set({
          name: (dto.organizationName ?? charity.organizationName).slice(0, 100),
          avatarUrl: dto.avatarUrl ?? charity.avatarUrl,
          updatedAt: this.clock.now(),
        })
        .where(eq(users.id, userId));
    });

    return this.get(charity.id, { id: userId, role: 'CHARITY' });
  }

  async requestWithdrawal(userId: string, amount: number, note?: string): Promise<CharityWithdrawalView> {
    const charity = await this.requireByUser(userId);
    if (amount < MIN_WITHDRAWAL) {
      throw AppError.badRequest(
        ErrorCode.validationFailed,
        `The minimum charity withdrawal is ${MIN_WITHDRAWAL} VND`,
      );
    }

    const withdrawal = await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(charities).where(eq(charities.id, charity.id)).for('update');
      if (!locked) throw AppError.notFound(ErrorCode.charityNotFound, 'Charity not found');
      if (!locked.isActive) throw AppError.conflict(ErrorCode.charityInactive, 'This charity account is inactive');

      const [pending] = await tx
        .select({ id: charityWithdrawals.id })
        .from(charityWithdrawals)
        .where(and(eq(charityWithdrawals.charityId, charity.id), eq(charityWithdrawals.status, 'PENDING')))
        .limit(1);
      if (pending) {
        throw AppError.conflict(ErrorCode.pendingWithdrawalExists, 'A withdrawal is already awaiting review');
      }
      if (locked.balance < amount) {
        throw AppError.unprocessable(
          ErrorCode.insufficientBalance,
          `Charity balance (${locked.balance} VND) is not enough for this withdrawal`,
        );
      }

      const now = this.clock.now();
      await tx
        .update(charities)
        .set({ balance: locked.balance - amount, updatedAt: now })
        .where(eq(charities.id, locked.id));

      const [row] = await tx
        .insert(charityWithdrawals)
        .values({ charityId: locked.id, amount, note: note ?? null })
        .returning();

      await this.wallet.post(tx, [
        {
          accountType: 'CHARITY',
          accountId: locked.userId,
          charityId: locked.id,
          direction: 'DEBIT',
          type: 'CHARITY_WITHDRAWAL',
          amount,
          note: note ?? 'Charity withdrawal requested',
        },
        {
          accountType: 'EXTERNAL',
          direction: 'CREDIT',
          type: 'CHARITY_WITHDRAWAL',
          amount,
          note: `Withdrawal payout for ${locked.organizationName}`,
        },
      ]);

      return row;
    });

    return this.mapWithdrawal(withdrawal, charity.organizationName);
  }

  async listMyWithdrawals(userId: string, query: ListCharityWithdrawalsQuery): Promise<Paginated<CharityWithdrawalView>> {
    const charity = await this.requireByUser(userId);
    const where = query.status
      ? and(eq(charityWithdrawals.charityId, charity.id), eq(charityWithdrawals.status, query.status))
      : eq(charityWithdrawals.charityId, charity.id);

    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(charityWithdrawals)
        .where(where)
        .orderBy(desc(charityWithdrawals.createdAt))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(charityWithdrawals).where(where),
    ]);

    return paginated(
      rows.map((row) => this.mapWithdrawal(row, charity.organizationName)),
      total?.value ?? 0,
      query.page,
      query.pageSize,
    );
  }

  async cancelWithdrawal(userId: string, withdrawalId: string): Promise<CharityWithdrawalView> {
    const charity = await this.requireByUser(userId);

    const updated = await this.db.transaction(async (tx) => {
      const [withdrawal] = await tx
        .select()
        .from(charityWithdrawals)
        .where(eq(charityWithdrawals.id, withdrawalId))
        .for('update');
      if (!withdrawal) throw AppError.notFound(ErrorCode.withdrawalNotFound, 'Withdrawal not found');
      if (withdrawal.charityId !== charity.id) {
        throw AppError.forbidden(ErrorCode.forbidden, 'This withdrawal belongs to another charity');
      }
      if (withdrawal.status !== 'PENDING') {
        throw AppError.conflict(ErrorCode.alreadyResolved, `Withdrawal is already ${withdrawal.status}`);
      }

      const [locked] = await tx.select().from(charities).where(eq(charities.id, charity.id)).for('update');
      const now = this.clock.now();
      await tx
        .update(charities)
        .set({ balance: locked.balance + withdrawal.amount, updatedAt: now })
        .where(eq(charities.id, charity.id));

      await this.wallet.post(tx, [
        {
          accountType: 'CHARITY',
          accountId: locked.userId,
          charityId: locked.id,
          direction: 'CREDIT',
          type: 'CHARITY_WITHDRAWAL',
          amount: withdrawal.amount,
          note: 'Withdrawal cancelled by charity',
        },
        {
          accountType: 'EXTERNAL',
          direction: 'DEBIT',
          type: 'CHARITY_WITHDRAWAL',
          amount: withdrawal.amount,
          note: 'Withdrawal cancelled by charity',
        },
      ]);

      const [row] = await tx
        .update(charityWithdrawals)
        .set({ status: 'CANCELLED', processedAt: now })
        .where(eq(charityWithdrawals.id, withdrawal.id))
        .returning();

      return row;
    });

    return this.mapWithdrawal(updated, charity.organizationName);
  }

  async adminList(query: ListAdminCharitiesQuery): Promise<Paginated<CharityView>> {
    const pattern = query.q ? `%${query.q}%` : null;
    const where = pattern
      ? or(ilike(charities.organizationName, pattern), ilike(charities.information, pattern))
      : undefined;

    const [rows, [total]] = await Promise.all([
      this.db
        .select({ charity: charities, accountId: users.id, accountEmail: users.email })
        .from(charities)
        .innerJoin(users, eq(users.id, charities.userId))
        .where(where)
        .orderBy(desc(charities.createdAt))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(charities).where(where),
    ]);

    const stats = await this.statsFor(rows.map((row) => row.charity.id));

    return paginated(
      rows.map((row) =>
        this.map(row.charity, stats.get(row.charity.id) ?? EMPTY_STATS, {
          id: row.accountId,
          email: row.accountEmail,
        }),
      ),
      total?.value ?? 0,
      query.page,
      query.pageSize,
    );
  }

  async adminCreate(dto: CreateCharityAccountDto): Promise<CharityView> {
    const passwordHash = await this.passwords.hash(dto.password);

    try {
      const charity = await this.db.transaction(async (tx) => {
        const [account] = await tx
          .insert(users)
          .values({
            email: dto.email.toLowerCase(),
            passwordHash,
            role: 'CHARITY',
            name: dto.organizationName.slice(0, 100),
            avatarUrl: dto.avatarUrl ?? null,
          })
          .returning();

        await this.wallet.getOrCreateWallet(tx, account.id);

        const [row] = await tx
          .insert(charities)
          .values({
            userId: account.id,
            organizationName: dto.organizationName,
            avatarUrl: dto.avatarUrl ?? null,
            information: dto.information ?? null,
            address: dto.address ?? null,
            email: dto.contactEmail ?? dto.email.toLowerCase(),
            phone: dto.phone ?? null,
          })
          .returning();

        return row;
      });

      return this.get(charity.id, { id: '', role: 'ADMIN' });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppError.conflict(ErrorCode.emailTaken, 'An account with this email already exists');
      }
      throw error;
    }
  }

  async adminUpdate(charityId: string, dto: UpdateCharityAsAdminDto): Promise<CharityView> {
    const [charity] = await this.db.select().from(charities).where(eq(charities.id, charityId)).limit(1);
    if (!charity) throw AppError.notFound(ErrorCode.charityNotFound, 'Charity not found');

    await this.db.transaction(async (tx) => {
      await tx
        .update(charities)
        .set({
          organizationName: dto.organizationName ?? charity.organizationName,
          information: dto.information ?? charity.information,
          address: dto.address ?? charity.address,
          email: dto.contactEmail ?? charity.email,
          phone: dto.phone ?? charity.phone,
          avatarUrl: dto.avatarUrl ?? charity.avatarUrl,
          isActive: dto.isActive ?? charity.isActive,
          updatedAt: this.clock.now(),
        })
        .where(eq(charities.id, charity.id));

      await tx
        .update(users)
        .set({
          name: (dto.organizationName ?? charity.organizationName).slice(0, 100),
          avatarUrl: dto.avatarUrl ?? charity.avatarUrl,
          ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
          updatedAt: this.clock.now(),
        })
        .where(eq(users.id, charity.userId));
    });

    if (dto.isActive === false) {
      await this.tokens.revokeAll(charity.userId);
    }

    return this.get(charity.id, { id: '', role: 'ADMIN' });
  }

  async adminListWithdrawals(query: ListCharityWithdrawalsQuery): Promise<Paginated<CharityWithdrawalView>> {
    const where = query.status ? eq(charityWithdrawals.status, query.status) : undefined;

    const [rows, [total]] = await Promise.all([
      this.db
        .select({ withdrawal: charityWithdrawals, charityName: charities.organizationName })
        .from(charityWithdrawals)
        .innerJoin(charities, eq(charities.id, charityWithdrawals.charityId))
        .where(where)
        .orderBy(desc(charityWithdrawals.createdAt))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(charityWithdrawals).where(where),
    ]);

    return paginated(
      rows.map((row) => this.mapWithdrawal(row.withdrawal, row.charityName)),
      total?.value ?? 0,
      query.page,
      query.pageSize,
    );
  }

  async adminResolveWithdrawal(
    adminId: string,
    withdrawalId: string,
    dto: ResolveCharityWithdrawalDto,
  ): Promise<CharityWithdrawalView> {
    const updated = await this.db.transaction(async (tx) => {
      const [withdrawal] = await tx
        .select()
        .from(charityWithdrawals)
        .where(eq(charityWithdrawals.id, withdrawalId))
        .for('update');
      if (!withdrawal) throw AppError.notFound(ErrorCode.withdrawalNotFound, 'Withdrawal not found');
      if (withdrawal.status !== 'PENDING') {
        throw AppError.conflict(ErrorCode.alreadyResolved, `Withdrawal is already ${withdrawal.status}`);
      }

      const [charity] = await tx.select().from(charities).where(eq(charities.id, withdrawal.charityId)).for('update');
      const now = this.clock.now();

      if (dto.decision === 'REJECTED') {
        await tx
          .update(charities)
          .set({ balance: charity.balance + withdrawal.amount, updatedAt: now })
          .where(eq(charities.id, charity.id));

        await this.wallet.post(tx, [
          {
            accountType: 'CHARITY',
            accountId: charity.userId,
            charityId: charity.id,
            direction: 'CREDIT',
            type: 'CHARITY_WITHDRAWAL',
            amount: withdrawal.amount,
            note: 'Withdrawal rejected; funds returned',
          },
          {
            accountType: 'EXTERNAL',
            direction: 'DEBIT',
            type: 'CHARITY_WITHDRAWAL',
            amount: withdrawal.amount,
            note: 'Withdrawal rejected; funds returned',
          },
        ]);
      }

      const [row] = await tx
        .update(charityWithdrawals)
        .set({
          status: dto.decision,
          note: dto.note ?? withdrawal.note,
          processedBy: adminId,
          processedAt: now,
        })
        .where(eq(charityWithdrawals.id, withdrawal.id))
        .returning();

      await this.notifications.send(tx, {
        userId: charity.userId,
        title: dto.decision === 'PAID' ? 'Charity withdrawal paid' : 'Charity withdrawal rejected',
        body:
          dto.decision === 'PAID'
            ? `A withdrawal of ${withdrawal.amount} VND was processed.`
            : `A withdrawal of ${withdrawal.amount} VND was rejected and returned to your balance.${dto.note ? ` Note: ${dto.note}` : ''}`,
        referenceUrl: '/charity/me/withdrawals',
      });

      return { row, charityName: charity.organizationName };
    });

    return this.mapWithdrawal(updated.row, updated.charityName);
  }

  private async listDonations(where: SQL | undefined, query: PageQueryDto) {
    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          donation: donations,
          charityName: charities.organizationName,
          donorId: users.id,
          donorName: users.name,
          donorAvatar: users.avatarUrl,
        })
        .from(donations)
        .innerJoin(charities, eq(charities.id, donations.charityId))
        .innerJoin(users, eq(users.id, donations.donorId))
        .where(where)
        .orderBy(desc(donations.createdAt))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(donations).where(where),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.donation.id,
        charityId: row.donation.charityId,
        charityName: row.charityName,
        amount: row.donation.amount,
        message: row.donation.message,
        donor: { id: row.donorId, name: row.donorName, avatarUrl: row.donorAvatar },
        createdAt: row.donation.createdAt.toISOString(),
      })),
      total?.value ?? 0,
      query.page,
      query.pageSize,
    );
  }

  private async requireByUser(userId: string): Promise<Charity> {
    const [charity] = await this.db.select().from(charities).where(eq(charities.userId, userId)).limit(1);
    if (!charity) throw AppError.notFound(ErrorCode.charityNotFound, 'You are not registered as a charity');
    return charity;
  }

  private async statsFor(ids: string[]): Promise<Map<string, CharityStats>> {
    if (ids.length === 0) return new Map();

    const rows = await this.db
      .select({
        charityId: donations.charityId,
        raised: sql<number>`coalesce(sum(${donations.amount}), 0)`,
        total: sql<number>`count(*)`,
        donors: sql<number>`count(distinct ${donations.donorId})`,
      })
      .from(donations)
      .where(inArray(donations.charityId, ids))
      .groupBy(donations.charityId);

    return new Map(
      rows.map((row) => [
        row.charityId,
        { raised: Number(row.raised), donations: Number(row.total), donors: Number(row.donors) },
      ]),
    );
  }

  private map(
    charity: Charity,
    stats: CharityStats,
    account: { id: string; email: string } | null,
  ): CharityView {
    return {
      id: charity.id,
      userId: charity.userId,
      organizationName: charity.organizationName,
      avatarUrl: charity.avatarUrl,
      information: charity.information,
      address: charity.address,
      email: charity.email,
      phone: charity.phone,
      balance: charity.balance,
      isActive: charity.isActive,
      createdAt: charity.createdAt.toISOString(),
      updatedAt: charity.updatedAt.toISOString(),
      stats,
      account,
    };
  }

  private mapWithdrawal(
    withdrawal: typeof charityWithdrawals.$inferSelect,
    charityName: string | null,
  ): CharityWithdrawalView {
    return {
      id: withdrawal.id,
      charityId: withdrawal.charityId,
      charityName,
      amount: withdrawal.amount,
      status: withdrawal.status,
      note: withdrawal.note,
      processedAt: withdrawal.processedAt?.toISOString() ?? null,
      createdAt: withdrawal.createdAt.toISOString(),
    };
  }
}
