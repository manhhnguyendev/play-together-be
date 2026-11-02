import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm';
import { AuditService, AUDIT_ACTIONS } from '../../common/audit/audit.service';
import { DB, type AppDatabase } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { offsetOf, paginated, type Paginated } from '../../common/pagination/pagination';
import type { AuthUser } from '../../common/security/auth-user';
import { TokenService } from '../../common/security/token.service';
import { Clock } from '../../common/time/time';
import {
  charityWithdrawals,
  donations,
  feedback,
  FINISHED_ORDER_STATUSES,
  ledgerEntries,
  orders,
  ratings,
  reports,
  SESSION_ORDER_STATUSES,
  SUPER_ADMIN_ROLE,
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
  BroadcastNotificationDto,
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
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async overview(): Promise<PlatformOverview> {
    const [
      [userAgg],
      orderRows,
      [feeRow],
      [donationRow],
      [userWithdrawals],
      [charityWithdrawalCount],
      [reportCount],
      [feedbackCount],
      [flaggedCount],
      escrowHeld,
    ] = await Promise.all([
      this.db
        .select({
          total: count(),
          active: sql<number>`count(*) filter (where ${users.isActive})`,
          players: sql<number>`count(*) filter (where ${users.isPlayer})`,
          charities: sql<number>`count(*) filter (where ${users.role} = 'CHARITY')`,
          admins: sql<number>`count(*) filter (where ${users.role} = 'ADMIN')`,
        })
        .from(users),
      this.db.select({ status: orders.status, value: count() }).from(orders).groupBy(orders.status),
      this.db
        .select({ value: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)` })
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.type, 'PLATFORM_FEE'), eq(ledgerEntries.accountType, 'PLATFORM'))),
      this.db.select({ value: sql<number>`coalesce(sum(${donations.amount}), 0)` }).from(donations),
      this.db.select({ value: count() }).from(withdrawals).where(eq(withdrawals.status, 'PENDING')),
      this.db
        .select({ value: count() })
        .from(charityWithdrawals)
        .where(eq(charityWithdrawals.status, 'PENDING')),
      this.db.select({ value: count() }).from(reports).where(eq(reports.status, 'PENDING')),
      this.db.select({ value: count() }).from(feedback).where(eq(feedback.status, 'PENDING')),
      this.db.select({ value: count() }).from(ratings).where(eq(ratings.violationStatus, 'FLAGGED')),
      this.wallet.escrowTotal(),
    ]);

    const byStatus: Record<string, number> = {};
    let totalOrders = 0;
    for (const row of orderRows) {
      byStatus[row.status] = Number(row.value);
      totalOrders += Number(row.value);
    }

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
        // Summed from the shared status groups. Reading `byStatus.PROCESSING`
        // by name would have kept compiling after the rename and just reported
        // zero active orders forever.
        active: SESSION_ORDER_STATUSES.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0),
        completed: FINISHED_ORDER_STATUSES.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0),
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

  async updateUser(admin: AuthUser, userId: string, dto: AdminUpdateUserDto): Promise<UserSummary> {
    const user = await this.usersService.requireById(userId);

    const nextRole = dto.role ?? user.role;
    const nextAdminRole = dto.adminRole === undefined ? user.adminRole : dto.adminRole;
    const nextActive = dto.isActive ?? user.isActive;

    const locks = dto.isActive === false && user.isActive;
    const unlocks = dto.isActive === true && !user.isActive;
    const changedRole = dto.role !== undefined && dto.role !== user.role;
    const changedAdminRole = dto.adminRole !== undefined && dto.adminRole !== user.adminRole;

    if (userId === admin.id && locks) {
      throw AppError.badRequest(ErrorCode.forbidden, 'You cannot lock your own account');
    }
    if (userId === admin.id && changedRole && dto.role !== 'ADMIN') {
      throw AppError.badRequest(ErrorCode.forbidden, 'You cannot remove your own admin role');
    }
    // Which tier an account holds, and whether it is an administrator at all,
    // is the privilege this console exists to hand out. A moderator who could
    // move those fields could hand themselves any tier, so only the tier that
    // appoints its own may change them.
    if ((changedRole || changedAdminRole) && admin.adminRole !== SUPER_ADMIN_ROLE) {
      throw AppError.forbidden(
        ErrorCode.adminRoleRequired,
        'Only a super admin can change an account role or back-office tier',
      );
    }
    if (nextAdminRole && nextRole !== 'ADMIN') {
      throw AppError.unprocessable(
        ErrorCode.validationFailed,
        'A back-office role can only sit on an account whose role is ADMIN',
      );
    }
    // Everything except a presence tweak is a privilege change, and the console
    // has to say why it made it.
    if ((locks || unlocks || changedRole || changedAdminRole) && !dto.reason?.trim()) {
      throw AppError.unprocessable(
        ErrorCode.reasonRequired,
        'A reason is required when locking an account or changing its roles',
      );
    }

    if (user.role === 'ADMIN' && changedRole && dto.role !== 'ADMIN') {
      const [row] = await this.db
        .select({ value: count() })
        .from(users)
        .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true), ne(users.id, userId)));
      if (Number(row?.value ?? 0) <= 0) {
        throw AppError.conflict(ErrorCode.conflict, 'At least one active administrator must remain');
      }
    }

    // The tier that can appoint another of its own must never be wiped out —
    // not by demotion, not by locking the account, not by demoting and locking
    // in one call.
    if (
      user.adminRole === SUPER_ADMIN_ROLE &&
      user.isActive &&
      !(nextAdminRole === SUPER_ADMIN_ROLE && nextActive)
    ) {
      const [remaining] = await this.db
        .select({ value: count() })
        .from(users)
        .where(
          and(
            eq(users.adminRole, SUPER_ADMIN_ROLE),
            eq(users.isActive, true),
            ne(users.id, userId),
          ),
        );
      if (Number(remaining?.value ?? 0) <= 0) {
        throw AppError.conflict(
          ErrorCode.lastSuperAdmin,
          'At least one active super admin must remain',
        );
      }
    }

    const nextPlayer = dto.isPlayer ?? (nextRole === 'USER' ? user.isPlayer : false);
    const nextStatus = !nextActive ? 'OFFLINE' : (dto.status ?? user.status);

    await this.db.transaction(async (tx) => {
      if (!nextActive && user.isActive) {
        await this.orders.interruptActiveForUser(
          tx,
          userId,
          'Account locked by an administrator',
          admin.id,
          this.clock.now(),
        );
      }

      await tx
        .update(users)
        .set({
          isActive: nextActive,
          isPlayer: nextPlayer,
          role: nextRole,
          adminRole: nextAdminRole,
          status: nextStatus,
          updatedAt: this.clock.now(),
        })
        .where(eq(users.id, userId));

      await this.audit.log(tx, {
        adminId: admin.id,
        adminRole: admin.adminRole,
        action: AUDIT_ACTIONS.userUpdate,
        entity: 'user',
        entityId: userId,
        reason: dto.reason,
        detail: {
          before: {
            isActive: user.isActive,
            role: user.role,
            adminRole: user.adminRole,
            status: user.status,
            isPlayer: user.isPlayer,
          },
          after: {
            isActive: nextActive,
            role: nextRole,
            adminRole: nextAdminRole,
            status: nextStatus,
            isPlayer: nextPlayer,
          },
        },
      });
    });

    if (!nextActive && user.isActive) {
      await this.tokens.revokeAll(userId);
    }

    const updated = await this.usersService.requireById(userId);
    return toUserSummary(updated, { includeEmail: true });
  }

  async adjustBehavior(
    admin: AuthUser,
    userId: string,
    points: number,
    satisfaction: number,
    note: string,
  ) {
    await this.usersService.requireById(userId);
    await this.db.transaction(async (tx) => {
      await this.behavior.adjust(tx, userId, 'MANUAL_ADJUSTMENT', { points, satisfaction }, undefined, note);
      await this.audit.log(tx, {
        adminId: admin.id,
        adminRole: admin.adminRole,
        action: AUDIT_ACTIONS.userBehavior,
        entity: 'user',
        entityId: userId,
        reason: note,
        detail: { points, satisfaction },
      });
    });
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
        .orderBy(desc(feedback.createdAt), desc(feedback.id))
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

  async resolveFeedback(admin: AuthUser, feedbackId: string, dto: ResolveFeedbackDto): Promise<AdminFeedbackView> {
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
          resolvedBy: admin.id,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(eq(feedback.id, feedbackId))
        .returning();

      await this.notifications.send(tx, {
        userId: updated.userId,
        title: dto.decision === 'APPROVED' ? 'Đã phản hồi góp ý' : 'Đã đóng góp ý',
        body: dto.adminNote ?? 'Cảm ơn bạn đã giúp PlayTogether tốt hơn.',
        referenceUrl: '/feedback/me',
      });

      await this.audit.log(tx, {
        adminId: admin.id,
        adminRole: admin.adminRole,
        action: AUDIT_ACTIONS.feedbackResolve,
        entity: 'feedback',
        entityId: feedbackId,
        reason: dto.adminNote,
        detail: { decision: dto.decision, authorId: updated.userId },
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

  async broadcast(admin: AuthUser, dto: BroadcastNotificationDto): Promise<{ recipients: number }> {
    const recipients = await this.notifications.broadcast(dto.title, dto.body, dto.referenceUrl);
    await this.audit.logOwn({
      adminId: admin.id,
      adminRole: admin.adminRole,
      action: AUDIT_ACTIONS.broadcast,
      entity: 'notification',
      reason: dto.reason,
      detail: { title: dto.title, recipients },
    });
    return { recipients };
  }

  async setMaintenance(admin: AuthUser, enabled: boolean, reason?: string): Promise<{ enabled: boolean }> {
    const key = CONFIG_KEYS.maintenanceMode;
    const row = await this.configs.getRaw(key);

    if (row) {
      await this.configs.update(admin, row.id, { value: enabled ? 1 : 0, reason });
    } else {
      const preset = CONFIG_DEFAULTS[key];
      await this.configs.create(admin, {
        key,
        no: preset.no,
        title: preset.title,
        value: enabled ? 1 : 0,
        description: preset.description,
        reason,
      });
    }

    await this.audit.logOwn({
      adminId: admin.id,
      adminRole: admin.adminRole,
      action: AUDIT_ACTIONS.maintenance,
      entity: 'system',
      reason,
      detail: { enabled },
    });

    return { enabled };
  }

  listWithdrawals(query: { page: number; pageSize: number; status?: 'PENDING' | 'PAID' | 'REJECTED' | 'CANCELLED' }) {
    return this.wallet.adminListWithdrawals(query);
  }

  resolveWithdrawal(admin: AuthUser, id: string, status: 'PAID' | 'REJECTED', note: string) {
    return this.wallet.resolveWithdrawal(id, status, note, admin);
  }
}
