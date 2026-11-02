import { index, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * One row per back-office mutation.
 *
 * The console used to change money, locks and catalog rows with no trace of who
 * did it or why, so a dispute about a payout could not be answered. `reason` is
 * free text supplied by the operator — required for anything that moves money —
 * and `detail` carries the before/after the UI showed, because the row itself
 * has usually moved on by the time anyone reads this.
 *
 * `adminId` survives deletion of the account (`set null`) rather than cascading:
 * an audit trail that erases itself when a staff account is removed is not an
 * audit trail.
 */
export const adminAuditLogs = pgTable(
  'admin_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id').references(() => users.id, { onDelete: 'set null' }),
    adminRole: varchar('admin_role', { length: 16 }),
    action: varchar('action', { length: 64 }).notNull(),
    entity: varchar('entity', { length: 32 }).notNull(),
    entityId: uuid('entity_id'),
    reason: varchar('reason', { length: 500 }),
    detail: jsonb('detail').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('admin_audit_logs_created_idx').on(t.createdAt),
    index('admin_audit_logs_admin_idx').on(t.adminId, t.createdAt),
    index('admin_audit_logs_entity_idx').on(t.entity, t.entityId),
  ],
);

export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;
export type NewAdminAuditLog = typeof adminAuditLogs.$inferInsert;
