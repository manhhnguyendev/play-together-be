import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const systemConfigs = pgTable(
  'system_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: varchar('key', { length: 100 }).notNull(),
    no: integer('no').notNull(),
    title: varchar('title', { length: 150 }).notNull(),
    value: integer('value').notNull(),
    description: text('description'),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('system_configs_key_key').on(t.key),
    uniqueIndex('system_configs_no_key').on(t.no),
    index('system_configs_no_idx').on(t.no),
    check('system_configs_value_check', sql`${t.value} >= 0`),
  ],
);

export const CONFIG_KEYS = {
  orderResponseMinutes: 'order.response_window_minutes',
  pendingReleaseHours: 'wallet.pending_release_hours',
  feedbackWindowHours: 'order.feedback_window_hours',
  platformFeeBps: 'order.platform_fee_bps',
  maintenanceMode: 'system.maintenance_mode',
} as const;

export const CONFIG_DEFAULTS: Record<string, { no: number; title: string; value: number; description: string }> = {
  [CONFIG_KEYS.orderResponseMinutes]: {
    no: 1,
    title: 'Order response window (minutes)',
    value: 5,
    description: 'How long a player has to accept or reject a hire request before it expires.',
  },
  [CONFIG_KEYS.pendingReleaseHours]: {
    no: 2,
    title: 'Pending earnings release (hours)',
    value: 6,
    description: 'How long player earnings stay pending before becoming withdrawable.',
  },
  [CONFIG_KEYS.feedbackWindowHours]: {
    no: 3,
    title: 'Rating and report window (hours)',
    value: 72,
    description: 'How long after an order ends that parties can rate or report each other.',
  },
  [CONFIG_KEYS.platformFeeBps]: {
    no: 4,
    title: 'Platform fee (basis points)',
    value: 1000,
    description: 'Commission taken from each settled order, in basis points (1000 = 10%).',
  },
  [CONFIG_KEYS.maintenanceMode]: {
    no: 5,
    title: 'Maintenance mode',
    value: 0,
    description: 'When 1, non-admin accounts cannot log in or create orders.',
  },
};

export type SystemConfig = typeof systemConfigs.$inferSelect;
