import { Inject, Injectable } from '@nestjs/common';
import { DB, type AppDatabase, type DbExecutor } from '../database/database.module';
import { adminAuditLogs, type AdminRole } from '../../db/schema';

/**
 * Every back-office mutation names itself here. The console turns these into
 * Vietnamese labels, so adding an action means adding both — an unlisted action
 * still shows up, just as its raw key.
 */
export const AUDIT_ACTIONS = {
  userUpdate: 'user.update',
  userBehavior: 'user.behavior_adjust',
  feedbackResolve: 'feedback.resolve',
  broadcast: 'notification.broadcast',
  maintenance: 'system.maintenance',
  withdrawalResolve: 'withdrawal.resolve',
  charityCreate: 'charity.create',
  charityUpdate: 'charity.update',
  charityPayoutResolve: 'charity.payout_resolve',
  reportResolve: 'report.resolve',
  ratingViolationResolve: 'rating.violation_resolve',
  gameCreate: 'catalog.game_create',
  gameUpdate: 'catalog.game_update',
  gameDelete: 'catalog.game_delete',
  rankCreate: 'catalog.rank_create',
  rankUpdate: 'catalog.rank_update',
  rankDelete: 'catalog.rank_delete',
  gameTypeCreate: 'catalog.game_type_create',
  gameTypeUpdate: 'catalog.game_type_update',
  gameTypeDelete: 'catalog.game_type_delete',
  configCreate: 'config.create',
  configUpdate: 'config.update',
  configDelete: 'config.delete',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditInput = {
  adminId: string;
  adminRole: AdminRole | null;
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  reason?: string | null;
  detail?: Record<string, unknown> | null;
};

/**
 * Who changed what, from which tier, and why they said they did it.
 *
 * Written inside the caller's transaction on purpose: a mutation that rolled
 * back must not leave a log entry claiming it happened.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: AppDatabase) {}

  async log(executor: DbExecutor, input: AuditInput): Promise<void> {
    await executor.insert(adminAuditLogs).values({
      adminId: input.adminId,
      adminRole: input.adminRole,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      reason: input.reason?.slice(0, 500) ?? null,
      detail: input.detail ?? null,
    });
  }

  /** Convenience for mutations that run outside a transaction. */
  logOwn(input: AuditInput): Promise<void> {
    return this.log(this.db, input);
  }
}
