import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { DB, type AppDatabase } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { offsetOf, paginated, type Paginated } from '../../common/pagination/pagination';
import { TokenService } from '../../common/security/token.service';
import { Clock } from '../../common/time/time';
import {
  charityWithdrawals,
  donations,
  feedback,
  ledgerEntries,
  orders,
  ratings,
  reports,
  users,
  withdrawals,
} from '../../db/schema';
import { CONFIG_KEYS, CONFIG_DEFAULTS } from '../../db/schema/config';
import { BehaviorService } from '../behavior/behavior.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { toUserSummary } from '../users/user.mapper';
import { StatsService } from '../users/stats.service';
import type { UserSummary } from '../users/users.dto';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import type {
  AdminFeedbackView,
  AdminUpdateUserDto,
  ListAdminFeedbackQuery,
  ListAdminUsersQuery,
  PlatformOverview,
  ResolveFeedbackDto,
} from './admin.dto';

@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly usersService: UsersService,
    private readonly orders: OrdersService,
    private readonly wallet: WalletService,
    private readonly behavior: BehaviorService,
    private readonly stats: StatsService,
    private readonly notifications: NotificationsService,
    private readonly configs: SystemConfigService,
    private readonly tokens: TokenService,
    private readonly clock: Clock,
  ) {}

  async overview(): Promise<PlatformOverview> {
    const [userAgg] = await this.db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${users.isActive})`,
        players: sql<number>`count(*) filter (where ${users.isPlayer})`,
        charities: sql<number>`count(*) filter (where ${users.role} = 'CHARITY')`,
        admins: sql<number>`count(*) filter (where ${users.role} = 'ADMIN')`,
      })
      .from(users);

    const orderRows = await this.db
      .select({ status: orders.status, value: count() })
      .from(orders)
      .groupBy(orders.status);

    const byStatus: Record<string, number> = {};
    let totalOrders = 0;
    for (const row of orderRows) {
      byStatus[row.status] = Number(row.value);
      totalOrders += Number(row.value);
    }

    const [feeRow] = await this.db
      .select({ value: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)` })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.type, 'PLATFORM_FEE'), eq(ledgerEntries.accountType, 'PLATFORM')));

    const [donationRow] = await this.db
      .select({ value: sql<number>`coalesce(sum(${donations.amount}), 0)` })
      .from(donations);

    const [userWithdrawals] = await this.db
      .select({ value: count() })
      .from(withdrawals)
      .where(eq(withdrawals.status, 'PENDING'));

    const [charityWithdrawalCount] = await this.db
      .select({ value: count() })
      .from(charityWithdrawals)
      .where(eq(charityWithdrawals.status, 'PENDING'));

    const [reportCount] = await this.db
      .select({ value: count() })
      .from(reports)
      .where(eq(reports.status, 'PENDING'));

    const [feedbackCount] = await this.db
      .select({ value: count() })
      .from(feedback)
      .where(eq(feedback.status, 'PENDING'));

    const [flaggedCount] = await this.db
      .select({ value: count() })
      .from(ratings)
      .where(eq(ratings.violationStatus, 'FLAGGED'));

    const escrowHeld = await this.wallet.escrowTotal();

    return {
      users: {
        total: Number(userAgg?.total ?? 0),
        active: Number(userAgg?.active ?? 0),
        players: Number(userAgg?.players ?? 0),
        charities: Number(userAgg?.charities ?? 0),
        admins: Number(userAgg?.admins ?? 0),
      },
      orders: {
        total: totalOrders,
        byStatus,
        active: (byStatus.PROCESSING ?? 0) + (byStatus.ACCEPTED ?? 0),
        completed: byStatus.COMPLETED ?? 0,
      },
      money: {
        platformFees: Number(feeRow?.value ?? 0),
        escrowHeld,
        donations: Number(donationRow?.value ?? 0),
        pendingUserWithdrawals: Number(userWithdrawals?.value ?? 0),
        pendingCharityWithdrawals: Number(charityWithdrawalCount?.value ?? 0),
      },
      moderation: {
        pendingReports: Number(reportCount?.value ?? 0),
        pendingFeedback: Number(feedbackCount?.value ?? 0),
        flaggedRatings: Number(flaggedCount?.value ?? 0),
      },
    };
  }

  listUsers(query: ListAdminUsersQuery): Promise<Paginated<UserSummary>> {
    return this.usersService.adminList({
      page: query.page,
      pageSize: query.pageSize,
      q: query.q,
      role: query.role,
      isActive: query.isActive === undefined ? undefined : query.isActive === 'true',
      isPlayer: query.isPlayer === undefined ? undefined : query.isPlayer === 'true',
    });
  }

  async updateUser(adminId: string, userId: string, dto: AdminUpdateUserDto): Promise<UserSummary> {
    const user = await this.usersService.requireById(userId);

    if (userId === adminId) {
      if (dto.isActive === false) throw AppError.badRequest(ErrorCode.forbidden, 'You cannot lock your own account');
      if (dto.role && dto.role !== 'ADMIN') {
        throw AppError.badRequest(ErrorCode.forbidden, 'You cannot remove your own admin role');
      }
    }

    if (user.role === 'ADMIN' && dto.role && dto.role !== 'ADMIN') {
      const [row] = await this.db
        .select({ value: count() })
        .from(users)
        .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true)));
      if (Number(row?.value ?? 0) <= 1) {
        throw AppError.conflict(ErrorCode.conflict, 'At least one active administrator must remain');
      }
    }

    const nextActive = dto.isActive ?? user.isActive;
    const nextRole = dto.role ?? user.role;
    const nextPlayer = dto.isPlayer ?? (nextRole === 'USER' ? user.isPlayer : false);
    const nextStatus = !nextActive ? 'OFFLINE' : (dto.status ?? user.status);

    await this.db.transaction(async (tx) => {
      if (!nextActive && user.isActive) {
        await this.orders.interruptActiveForUser(
          tx,
          userId,
          'Account locked by an administrator',
          adminId,
          this.clock.now(),
        );
      }

      await tx
        .update(users)
        .set({
          isActive: nextActive,
          isPlayer: nextPlayer,
          role: nextRole,
          status: nextStatus,
          updatedAt: this.clock.now(),
        })
        .where(eq(users.id, userId));
    });

    if (!nextActive && user.isActive) {
      await this.tokens.revokeAll(userId);
    }

    const updated = await this.usersService.requireById(userId);
    return toUserSummary(updated, { includeEmail: true });
  }

  async adjustBehavior(adminId: string, userId: string, points: number, satisfaction: number, note?: string) {
    await this.usersService.requireById(userId);
    await this.behavior.adjust(
      this.db,
      userId,
      'MANUAL_ADJUSTMENT',
      { points, satisfaction },
      undefined,
      note ?? `Adjusted by administrator ${adminId}`,
    );
    const recomputed = await this.stats.recompute(userId);
    return { userId, ...recomputed };
  }

  async listFeedback(query: ListAdminFeedbackQuery): Promise<Paginated<AdminFeedbackView>> {
    const filters: SQL[] = [];
    if (query.status) filters.push(eq(feedback.status, query.status));
    if (query.q) {
      const pattern = `%${query.q}%`;
      filters.push(or(ilike(feedback.title, pattern), ilike(feedback.message, pattern))!);
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const [rows, [total]] = await Promise.all([
      this.db
        .select({ entry: feedback, author: { id: users.id, name: users.name, email: users.email } })
        .from(feedback)
        .innerJoin(users, eq(users.id, feedback.userId))
        .where(where)
        .orderBy(desc(feedback.createdAt))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(feedback).where(where),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.entry.id,
        userId: row.entry.userId,
        author: row.author,
        title: row.entry.title,
        message: row.entry.message,
        type: row.entry.type,
        status: row.entry.status,
        adminNote: row.entry.adminNote,
        resolvedAt: row.entry.resolvedAt?.toISOString() ?? null,
        createdAt: row.entry.createdAt.toISOString(),
      })),
      total?.value ?? 0,
      query.page,
      query.pageSize,
    );
  }

  async resolveFeedback(adminId: string, feedbackId: string, dto: ResolveFeedbackDto): Promise<AdminFeedbackView> {
    const entry = await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(feedback).where(eq(feedback.id, feedbackId)).for('update');
      if (!row) throw AppError.notFound(ErrorCode.feedbackNotFound, 'Feedback not found');
      if (row.status !== 'PENDING') {
        throw AppError.conflict(ErrorCode.alreadyResolved, `Feedback is already ${row.status}`);
      }

      const now = this.clock.now();
      const [updated] = await tx
        .update(feedback)
        .set({
          status: dto.decision,
          adminNote: dto.adminNote ?? null,
          resolvedBy: adminId,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(eq(feedback.id, feedbackId))
        .returning();

      await this.notifications.send(tx, {
        userId: updated.userId,
        title: dto.decision === 'APPROVED' ? 'Feedback acknowledged' : 'Feedback closed',
        body: dto.adminNote ?? 'Thank you for helping us improve PlayTogether.',
        referenceUrl: '/feedback/me',
      });

      return updated;
    });

    const [author] = await this.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, entry.userId))
      .limit(1);

    return {
      id: entry.id,
      userId: entry.userId,
      author: author ?? null,
      title: entry.title,
      message: entry.message,
      type: entry.type,
      status: entry.status,
      adminNote: entry.adminNote,
      resolvedAt: entry.resolvedAt?.toISOString() ?? null,
      createdAt: entry.createdAt.toISOString(),
    };
  }

  broadcast(title: string, body: string, referenceUrl?: string): Promise<{ recipients: number }> {
    return this.notifications.broadcast(title, body, referenceUrl).then((recipients) => ({ recipients }));
  }

  async setMaintenance(enabled: boolean): Promise<{ enabled: boolean }> {
    const key = CONFIG_KEYS.maintenanceMode;
    const row = await this.configs.getRaw(key);

    if (row) {
      await this.configs.update(row.id, { value: enabled ? 1 : 0 });
    } else {
      const preset = CONFIG_DEFAULTS[key];
      await this.configs.create({
        key,
        no: preset.no,
        title: preset.title,
        value: enabled ? 1 : 0,
        description: preset.description,
      });
    }

    return { enabled };
  }

  listWithdrawals(query: { page: number; pageSize: number; status?: 'PENDING' | 'PAID' | 'REJECTED' | 'CANCELLED' }) {
    return this.wallet.adminListWithdrawals(query);
  }

  resolveWithdrawal(id: string, status: 'PAID' | 'REJECTED', note?: string) {
    return this.wallet.resolveWithdrawal(id, status, note);
  }
}
