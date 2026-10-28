import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DB, type AppDatabase, type DbExecutor } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { isUniqueViolation } from '../../common/errors/pg-errors';
import { offsetOf, paginated, type Paginated } from '../../common/pagination/pagination';
import { addHours, Clock } from '../../common/time/time';
import { CONFIG_KEYS, orders, ratings, reports, users, type Report } from '../../db/schema';
import { TokenService } from '../../common/security/token.service';
import { BehaviorService } from '../behavior/behavior.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { StatsService } from '../users/stats.service';
import { WalletService } from '../wallet/wallet.service';
import type {
  ListAdminReportsQuery,
  ListReportsQuery,
  ReportDto,
  ReportParty,
  ResolveReportDto,
} from './reports.dto';

const REPORTABLE_STATUSES = ['COMPLETED', 'ENDED_EARLY_BY_HIRER', 'ENDED_EARLY_BY_PLAYER'] as const;

const reporterTable = alias(users, 'reporter');
const targetTable = alias(users, 'target');

const partyOf = (row: { id: string; name: string; avatarUrl: string | null } | null): ReportParty | null =>
  row ? { id: row.id, name: row.name, avatarUrl: row.avatarUrl } : null;

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly clock: Clock,
    private readonly configs: SystemConfigService,
    private readonly behavior: BehaviorService,
    private readonly stats: StatsService,
    private readonly notifications: NotificationsService,
    private readonly wallet: WalletService,
    private readonly orders: OrdersService,
    private readonly tokens: TokenService,
  ) {}

  async create(reporterId: string, orderId: string, message: string): Promise<ReportDto> {
    const [order] = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) throw AppError.notFound(ErrorCode.orderNotFound, 'Order not found');

    const isHirer = order.hirerId === reporterId;
    const isPlayer = order.playerId === reporterId;
    if (!isHirer && !isPlayer) {
      throw AppError.forbidden(ErrorCode.orderNotParticipant, 'Only the hirer or the player can report this order');
    }

    if (!REPORTABLE_STATUSES.includes(order.status as (typeof REPORTABLE_STATUSES)[number])) {
      throw AppError.conflict(ErrorCode.invalidOrderState, 'Only finished orders can be reported');
    }

    const endedAt = order.endedAt ?? order.scheduledEndAt;
    if (!endedAt) throw AppError.conflict(ErrorCode.invalidOrderState, 'Order has no completion timestamp');

    const windowHours = await this.configs.getNumber(CONFIG_KEYS.feedbackWindowHours);
    if (this.clock.now().getTime() > addHours(endedAt, windowHours).getTime()) {
      throw AppError.conflict(
        ErrorCode.feedbackWindowClosed,
        `Reports are only accepted within ${windowHours} hours of the order ending`,
      );
    }

    const [existing] = await this.db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.orderId, orderId), eq(reports.reporterId, reporterId)))
      .limit(1);
    if (existing) throw AppError.conflict(ErrorCode.alreadyReported, 'You already reported this order');

    const [existingRating] = await this.db
      .select({ id: ratings.id })
      .from(ratings)
      .where(and(eq(ratings.orderId, orderId), eq(ratings.raterId, reporterId)))
      .limit(1);
    if (existingRating) {
      throw AppError.conflict(
        ErrorCode.conflict,
        'You already rated the other party on this order, so you cannot report it',
      );
    }

    const targetId = isHirer ? order.playerId : order.hirerId;

    let created: Report;
    try {
      created = await this.db.transaction(async (tx) => {
        const [report] = await tx
          .insert(reports)
          .values({ orderId, reporterId, targetId, message })
          .returning();

        await this.notifications.send(tx, {
          userId: targetId,
          title: 'You have been reported',
          body: `A report was filed on order ${orderId}. Our moderators will review it.`,
          referenceUrl: `/orders/${orderId}`,
        });

        return report;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppError.conflict(ErrorCode.alreadyReported, 'You already reported this order');
      }
      throw error;
    }

    return this.withParties(created, this.db);
  }

  async listMine(userId: string, query: ListReportsQuery): Promise<Paginated<ReportDto>> {
    const scopeFilter =
      query.scope === 'received' ? eq(reports.targetId, userId) : eq(reports.reporterId, userId);
    const filters = [scopeFilter];
    if (query.status) filters.push(eq(reports.status, query.status));
    if (query.orderId) filters.push(eq(reports.orderId, query.orderId));
    const where = and(...filters);

    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          report: reports,
          reporterId: reporterTable.id,
          reporterName: reporterTable.name,
          reporterAvatar: reporterTable.avatarUrl,
          targetId: targetTable.id,
          targetName: targetTable.name,
          targetAvatar: targetTable.avatarUrl,
        })
        .from(reports)
        .innerJoin(reporterTable, eq(reporterTable.id, reports.reporterId))
        .innerJoin(targetTable, eq(targetTable.id, reports.targetId))
        .where(where)
        .orderBy(desc(reports.createdAt))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(reports).where(where),
    ]);

    return paginated(rows.map((row) => this.map(row)), total?.value ?? 0, query.page, query.pageSize);
  }

  async get(reportId: string, viewer: { id: string; role: string }): Promise<ReportDto> {
    const [row] = await this.db
      .select({
        report: reports,
        reporterId: reporterTable.id,
        reporterName: reporterTable.name,
        reporterAvatar: reporterTable.avatarUrl,
        targetId: targetTable.id,
        targetName: targetTable.name,
        targetAvatar: targetTable.avatarUrl,
      })
      .from(reports)
      .innerJoin(reporterTable, eq(reporterTable.id, reports.reporterId))
      .innerJoin(targetTable, eq(targetTable.id, reports.targetId))
      .where(eq(reports.id, reportId))
      .limit(1);

    if (!row) throw AppError.notFound(ErrorCode.reportNotFound, 'Report not found');
    if (viewer.role !== 'ADMIN' && row.report.reporterId !== viewer.id && row.report.targetId !== viewer.id) {
      throw AppError.forbidden(ErrorCode.forbidden, 'You are not a party of this report');
    }

    return this.map(row);
  }

  async adminList(query: ListAdminReportsQuery): Promise<Paginated<ReportDto>> {
    const filters = [];
    if (query.status) filters.push(eq(reports.status, query.status));
    if (query.q) filters.push(ilike(reports.message, `%${query.q}%`));
    const where = filters.length > 0 ? and(...filters) : undefined;

    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          report: reports,
          reporterId: reporterTable.id,
          reporterName: reporterTable.name,
          reporterAvatar: reporterTable.avatarUrl,
          targetId: targetTable.id,
          targetName: targetTable.name,
          targetAvatar: targetTable.avatarUrl,
        })
        .from(reports)
        .innerJoin(reporterTable, eq(reporterTable.id, reports.reporterId))
        .innerJoin(targetTable, eq(targetTable.id, reports.targetId))
        .where(where)
        .orderBy(desc(reports.createdAt))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(reports).where(where),
    ]);

    return paginated(rows.map((row) => this.map(row)), total?.value ?? 0, query.page, query.pageSize);
  }

  async resolve(adminId: string, reportId: string, dto: ResolveReportDto): Promise<ReportDto> {
    const outcome = await this.db.transaction(async (tx) => {
      const [report] = await tx.select().from(reports).where(eq(reports.id, reportId)).for('update');
      if (!report) throw AppError.notFound(ErrorCode.reportNotFound, 'Report not found');
      if (report.status !== 'PENDING') {
        throw AppError.conflict(ErrorCode.alreadyResolved, `Report is already ${report.status}`);
      }

      const now = this.clock.now();

      if (dto.decision === 'REJECTED') {
        const [updated] = await tx
          .update(reports)
          .set({
            status: 'REJECTED',
            resolutionNote: dto.note ?? null,
            resolvedBy: adminId,
            resolvedAt: now,
          })
          .where(eq(reports.id, report.id))
          .returning();

        await this.notifications.send(tx, {
          userId: report.reporterId,
          title: 'Report dismissed',
          body: dto.note ? `Your report was dismissed: ${dto.note}` : 'Your report was reviewed and dismissed.',
          referenceUrl: `/reports/${report.id}`,
        });

        return { report: updated, disabled: false, targetId: report.targetId };
      }

      const points = dto.points ?? 0;
      const satisfaction = dto.satisfaction ?? 0;
      if (points > 0 || satisfaction > 0) {
        await this.behavior.adjust(
          tx,
          report.targetId,
          'REPORT_APPROVED',
          { points: points > 0 ? -points : undefined, satisfaction: satisfaction > 0 ? -satisfaction : undefined },
          report.id,
          dto.note ?? 'Upheld report',
        );
        await this.stats.recompute(report.targetId, tx);
      }

      let refunded = 0;
      if (dto.refundAmount && dto.refundAmount > 0) {
        const [order] = await tx.select().from(orders).where(eq(orders.id, report.orderId)).limit(1);
        if (!order) throw AppError.notFound(ErrorCode.orderNotFound, 'Order not found');
        if (order.playerId !== report.targetId) {
          throw AppError.unprocessable(
            ErrorCode.validationFailed,
            'Only a player can be charged; the report target is the hirer',
          );
        }
        const maxRefund = order.playerPayout ?? 0;
        if (dto.refundAmount > maxRefund) {
          throw AppError.unprocessable(
            ErrorCode.validationFailed,
            `Refund cannot exceed the player payout (${maxRefund} VND)`,
          );
        }
        await this.wallet.refundFromPlayerToHirer(tx, {
          orderId: report.orderId,
          playerId: report.targetId,
          hirerId: order.hirerId,
          amount: dto.refundAmount,
        });
        refunded = dto.refundAmount;
      }

      if (dto.disableAccount) {
        await this.orders.interruptActiveForUser(
          tx,
          report.targetId,
          'Account disabled after an upheld report',
          adminId,
          now,
        );
        await tx
          .update(users)
          .set({ isActive: false, isPlayer: false, status: 'OFFLINE', updatedAt: now })
          .where(eq(users.id, report.targetId));
      }

      const [updated] = await tx
        .update(reports)
        .set({
          status: 'APPROVED',
          resolutionNote: dto.note ?? null,
          resolvedBy: adminId,
          resolvedAt: now,
        })
        .where(eq(reports.id, report.id))
        .returning();

      const penalty =
        points > 0 || satisfaction > 0
          ? ` Deducted ${points} behavior points and ${satisfaction} satisfaction points.`
          : '';
      const compensation = refunded > 0 ? ` ${refunded} VND was refunded to the hirer.` : '';
      const locked = dto.disableAccount ? ' Your account has been locked.' : '';

      await this.notifications.sendMany(tx, [
        {
          userId: report.targetId,
          title: 'Report upheld',
          body: `A report against you was upheld.${penalty}${locked}${dto.note ? ` Note: ${dto.note}` : ''}`,
          referenceUrl: `/reports/${report.id}`,
        },
        {
          userId: report.reporterId,
          title: 'Report upheld',
          body: `Your report was upheld.${compensation}${dto.note ? ` Note: ${dto.note}` : ''}`,
          referenceUrl: `/reports/${report.id}`,
        },
      ]);

      return { report: updated, disabled: Boolean(dto.disableAccount), targetId: report.targetId };
    });

    if (outcome.disabled) {
      await this.tokens.revokeAll(outcome.targetId);
    }

    return this.withParties(outcome.report, this.db);
  }

  private async withParties(report: Report, executor: DbExecutor): Promise<ReportDto> {
    const ids = report.reporterId === report.targetId ? [report.reporterId] : [report.reporterId, report.targetId];
    const rows = await executor
      .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
      .from(users)
      .where(inArray(users.id, ids));
    const byId = new Map(rows.map((row) => [row.id, row]));

    return this.map({ report, reporter: byId.get(report.reporterId) ?? null, target: byId.get(report.targetId) ?? null });
  }

  private map(row: {
    report: Report;
    reporter?: ReportParty | null;
    reporterId?: string;
    reporterName?: string;
    reporterAvatar?: string | null;
    target?: ReportParty | null;
    targetId?: string;
    targetName?: string;
    targetAvatar?: string | null;
  }): ReportDto {
    const reporter =
      row.reporter ??
      (row.reporterId ? { id: row.reporterId, name: row.reporterName ?? '', avatarUrl: row.reporterAvatar ?? null } : null);
    const target =
      row.target ??
      (row.targetId ? { id: row.targetId, name: row.targetName ?? '', avatarUrl: row.targetAvatar ?? null } : null);

    return {
      id: row.report.id,
      orderId: row.report.orderId,
      reporter: partyOf(reporter),
      target: partyOf(target),
      message: row.report.message,
      status: row.report.status,
      resolutionNote: row.report.resolutionNote,
      resolvedAt: row.report.resolvedAt?.toISOString() ?? null,
      createdAt: row.report.createdAt.toISOString(),
    };
  }
}
