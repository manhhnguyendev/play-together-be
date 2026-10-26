import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { charities } from './charity';
import {
  depositStatusEnum,
  escrowStatusEnum,
  ledgerAccountEnum,
  ledgerDirectionEnum,
  ledgerTypeEnum,
  payoutStatusEnum,
} from './enums';
import { orders } from './orders';
import { users } from './users';

export const wallets = pgTable(
  'wallets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    availableBalance: bigint('available_balance', { mode: 'number' }).notNull().default(0),
    pendingBalance: bigint('pending_balance', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('wallets_user_key').on(t.userId),
    check('wallets_available_check', sql`${t.availableBalance} >= 0`),
    check('wallets_pending_check', sql`${t.pendingBalance} >= 0`),
  ],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id').notNull(),
    accountType: ledgerAccountEnum('account_type').notNull(),
    accountId: uuid('account_id'),
    walletId: uuid('wallet_id').references(() => wallets.id, { onDelete: 'set null' }),
    charityId: uuid('charity_id').references(() => charities.id, { onDelete: 'set null' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    direction: ledgerDirectionEnum('direction').notNull(),
    type: ledgerTypeEnum('type').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('ledger_entries_transaction_idx').on(t.transactionId),
    index('ledger_entries_wallet_idx').on(t.walletId, t.createdAt),
    index('ledger_entries_charity_idx').on(t.charityId, t.createdAt),
    check('ledger_entries_amount_check', sql`${t.amount} > 0`),
  ],
);

export const escrowHolds = pgTable(
  'escrow_holds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    hirerWalletId: uuid('hirer_wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'restrict' }),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    status: escrowStatusEnum('status').notNull().default('HELD'),
    settledAmount: bigint('settled_amount', { mode: 'number' }).notNull().default(0),
    refundedAmount: bigint('refunded_amount', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('escrow_holds_order_key').on(t.orderId),
    check('escrow_holds_amount_check', sql`${t.amount} > 0`),
    check('escrow_holds_settled_check', sql`${t.settledAmount} >= 0`),
    check('escrow_holds_refunded_check', sql`${t.refundedAmount} >= 0`),
    check('escrow_holds_total_check', sql`${t.settledAmount} + ${t.refundedAmount} <= ${t.amount}`),
  ],
);

export const pendingCredits = pgTable(
  'pending_credits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('pending_credits_release_idx').on(t.releasedAt, t.availableAt),
    index('pending_credits_wallet_idx').on(t.walletId),
    check('pending_credits_amount_check', sql`${t.amount} > 0`),
  ],
);

export const deposits = pgTable(
  'deposits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    provider: varchar('provider', { length: 30 }).notNull().default('MOMO'),
    providerTxnId: varchar('provider_txn_id', { length: 100 }),
    status: depositStatusEnum('status').notNull().default('PENDING'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('deposits_provider_txn_key')
      .on(t.providerTxnId)
      .where(sql`${t.providerTxnId} is not null`),
    index('deposits_user_idx').on(t.userId, t.createdAt),
    check('deposits_amount_check', sql`${t.amount} > 0`),
  ],
);

export const withdrawals = pgTable(
  'withdrawals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    provider: varchar('provider', { length: 30 }).notNull().default('MOMO'),
    providerTxnId: varchar('provider_txn_id', { length: 100 }),
    status: payoutStatusEnum('status').notNull().default('PENDING'),
    note: varchar('note', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('withdrawals_user_idx').on(t.userId, t.createdAt),
    check('withdrawals_amount_check', sql`${t.amount} > 0`),
  ],
);

export type Wallet = typeof wallets.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type PendingCredit = typeof pendingCredits.$inferSelect;
