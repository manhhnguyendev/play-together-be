import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { payoutStatusEnum } from './enums';
import { users } from './users';

export const charities = pgTable(
  'charities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationName: varchar('organization_name', { length: 150 }).notNull(),
    avatarUrl: text('avatar_url'),
    information: text('information'),
    address: varchar('address', { length: 200 }),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 20 }),
    balance: bigint('balance', { mode: 'number' }).notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('charities_user_key').on(t.userId),
    index('charities_active_idx').on(t.isActive),
    check('charities_balance_check', sql`${t.balance} >= 0`),
  ],
);

export const donations = pgTable(
  'donations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    donorId: uuid('donor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    charityId: uuid('charity_id')
      .notNull()
      .references(() => charities.id, { onDelete: 'restrict' }),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    message: varchar('message', { length: 1000 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('donations_charity_idx').on(t.charityId, t.createdAt),
    index('donations_donor_idx').on(t.donorId, t.createdAt),
    check('donations_amount_check', sql`${t.amount} >= 1000`),
  ],
);

export const charityWithdrawals = pgTable(
  'charity_withdrawals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    charityId: uuid('charity_id')
      .notNull()
      .references(() => charities.id, { onDelete: 'cascade' }),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    status: payoutStatusEnum('status').notNull().default('PENDING'),
    note: varchar('note', { length: 255 }),
    processedBy: uuid('processed_by').references(() => users.id, { onDelete: 'set null' }),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('charity_withdrawals_charity_idx').on(t.charityId, t.createdAt),
    check('charity_withdrawals_amount_check', sql`${t.amount} > 0`),
  ],
);

export type Charity = typeof charities.$inferSelect;
export type Donation = typeof donations.$inferSelect;
