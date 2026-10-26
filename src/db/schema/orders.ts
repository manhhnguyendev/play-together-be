import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { games } from './catalog';
import { orderStatusEnum } from './enums';
import { users } from './users';

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hirerId: uuid('hirer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: orderStatusEnum('status').notNull().default('PROCESSING'),
    hours: smallint('hours').notNull(),
    hourlyRate: bigint('hourly_rate', { mode: 'number' }).notNull(),
    totalPrice: bigint('total_price', { mode: 'number' }).notNull(),
    feeBps: integer('fee_bps').notNull(),
    playerPayout: bigint('player_payout', { mode: 'number' }),
    message: varchar('message', { length: 500 }).notNull(),
    reason: varchar('reason', { length: 500 }),
    respondBy: timestamp('respond_by', { withTimezone: true, mode: 'date' }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }),
    scheduledEndAt: timestamp('scheduled_end_at', { withTimezone: true, mode: 'date' }),
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('orders_one_active_per_hirer')
      .on(t.hirerId)
      .where(sql`${t.status} in ('PROCESSING', 'ACCEPTED')`),
    uniqueIndex('orders_one_active_per_player')
      .on(t.playerId)
      .where(sql`${t.status} in ('PROCESSING', 'ACCEPTED')`),
    index('orders_hirer_idx').on(t.hirerId, t.createdAt),
    index('orders_player_idx').on(t.playerId, t.createdAt),
    index('orders_status_idx').on(t.status, t.respondBy),
    check('orders_hours_check', sql`${t.hours} between 1 and 12`),
    check('orders_total_price_check', sql`${t.totalPrice} >= 0`),
    check('orders_fee_check', sql`${t.feeBps} between 0 and 5000`),
    check('orders_payout_check', sql`${t.playerPayout} is null or ${t.playerPayout} between 0 and ${t.totalPrice}`),
    check('orders_distinct_parties_check', sql`${t.hirerId} <> ${t.playerId}`),
  ],
);

export const orderGames = pgTable(
  'order_games',
  {
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.gameId] }), index('order_games_game_idx').on(t.gameId)],
);

export const orderStatusHistory = pgTable(
  'order_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromStatus: orderStatusEnum('from_status'),
    toStatus: orderStatusEnum('to_status').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('order_status_history_order_idx').on(t.orderId, t.createdAt)],
);

export type Order = typeof orders.$inferSelect;
export type OrderStatus = Order['status'];
