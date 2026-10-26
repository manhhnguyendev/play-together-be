import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  behaviorEventEnum,
  behaviorOperationEnum,
  moderationStatusEnum,
  theBehaviorPointTypeEnum,
  violationStatusEnum,
} from './enums';
import { orders } from './orders';
import { users } from './users';

export const ratings = pgTable(
  'ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    raterId: uuid('rater_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rateeId: uuid('ratee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rate: smallint('rate').notNull(),
    comment: varchar('comment', { length: 500 }),
    isActive: boolean('is_active').notNull().default(true),
    violationStatus: violationStatusEnum('violation_status').notNull().default('NONE'),
    violationReason: varchar('violation_reason', { length: 500 }),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ratings_order_rater_key').on(t.orderId, t.raterId),
    index('ratings_ratee_idx').on(t.rateeId, t.isActive, t.createdAt),
    check('ratings_rate_check', sql`${t.rate} between 1 and 5`),
    check('ratings_parties_check', sql`${t.raterId} <> ${t.rateeId}`),
  ],
);

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetId: uuid('target_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    message: varchar('message', { length: 500 }).notNull(),
    status: moderationStatusEnum('status').notNull().default('PENDING'),
    resolutionNote: text('resolution_note'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('reports_order_reporter_key').on(t.orderId, t.reporterId),
    index('reports_status_idx').on(t.status, t.createdAt),
    index('reports_target_idx').on(t.targetId),
    check('reports_parties_check', sql`${t.reporterId} <> ${t.targetId}`),
  ],
);

export const behaviorPoints = pgTable(
  'behavior_points',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    points: integer('points').notNull().default(100),
    satisfaction: integer('satisfaction').notNull().default(100),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    check('behavior_points_points_check', sql`${t.points} between 0 and 100`),
    check('behavior_points_satisfaction_check', sql`${t.satisfaction} between 0 and 100`),
  ],
);

export const behaviorHistory = pgTable(
  'behavior_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    event: behaviorEventEnum('event').notNull(),
    operation: behaviorOperationEnum('operation').notNull(),
    pointType: theBehaviorPointTypeEnum('point_type').notNull(),
    amount: integer('amount').notNull(),
    referenceId: uuid('reference_id'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('behavior_history_user_idx').on(t.userId, t.createdAt),
    check('behavior_history_amount_check', sql`${t.amount} > 0`),
  ],
);

export type Rating = typeof ratings.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type BehaviorPoint = typeof behaviorPoints.$inferSelect;
