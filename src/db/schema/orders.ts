import { sql, type SQL } from 'drizzle-orm';
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
import { orderCloseReasonEnum, orderPartyEnum, orderStatusEnum } from './enums';
import { users } from './users';

/**
 * Which stage a status belongs to. These sets used to be re-typed inside the
 * orders, ratings, reports and stats services, and the copies were plain string
 * arrays or raw SQL — so a rename silently missed all of them. They are declared
 * above the table because the availability index below is built from them: a
 * literal `in (...)` predicate and a separate array in the service are two
 * sources of truth waiting to disagree.
 */
export const ORDER_STATUS_GROUPS = {
  /** Nothing has happened yet but the request is still alive. */
  proposed: ['PROPOSED'],
  /** A booked-or-running session: the calendar is what these reserve. */
  session: ['SCHEDULED', 'LIVE'],
  /** Booked ahead: the slot is held, the money is in escrow, nothing has begun. */
  scheduled: ['SCHEDULED'],
  /** A session running right now — a party can only be in one of these. */
  live: ['LIVE'],
  /** The session ended and its payout is being reconciled; nobody is blocked. */
  disputed: ['DISPUTED'],
  /** The session reached an end and the money moved: it counts as completed. */
  finished: ['SETTLED', 'ENDED_EARLY'],
  /** The session is over from the parties' point of view: rating and reporting are open. */
  feedback: ['DISPUTED', 'SETTLED', 'ENDED_EARLY'],
  /** Hirer money is still held, so an admin may still have to unwind it. */
  escrowed: ['SCHEDULED', 'LIVE', 'DISPUTED'],
} as const satisfies Record<string, readonly (typeof orderStatusEnum.enumValues)[number][]>;

export const PROPOSED_ORDER_STATUSES = ORDER_STATUS_GROUPS.proposed;
export const SESSION_ORDER_STATUSES = ORDER_STATUS_GROUPS.session;
export const SCHEDULED_ORDER_STATUSES = ORDER_STATUS_GROUPS.scheduled;
export const LIVE_ORDER_STATUSES = ORDER_STATUS_GROUPS.live;
export const DISPUTED_ORDER_STATUSES = ORDER_STATUS_GROUPS.disputed;
export const FINISHED_ORDER_STATUSES = ORDER_STATUS_GROUPS.finished;
export const FEEDBACK_ORDER_STATUSES = ORDER_STATUS_GROUPS.feedback;
export const ESCROW_ORDER_STATUSES = ORDER_STATUS_GROUPS.escrowed;

/**
 * Inlined as SQL literals, not parameters: this feeds a partial index predicate
 * in the generated DDL, and `sql.join` would emit `$1, $2` there. The values can
 * only come from ORDER_STATUS_GROUPS above, which is typed against the enum.
 */
const STATUS_LIST = (statuses: readonly string[]): SQL =>
  sql.raw(statuses.map((status) => `'${status}'`).join(', '));

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
    status: orderStatusEnum('status').notNull().default('PROPOSED'),
    hours: smallint('hours').notNull(),
    hourlyRate: bigint('hourly_rate', { mode: 'number' }).notNull(),
    totalPrice: bigint('total_price', { mode: 'number' }).notNull(),
    feeBps: integer('fee_bps').notNull(),
    playerPayout: bigint('player_payout', { mode: 'number' }),
    message: varchar('message', { length: 500 }).notNull(),
    reason: varchar('reason', { length: 500 }),
    closeReason: orderCloseReasonEnum('close_reason'),
    endedEarlyBy: orderPartyEnum('ended_early_by'),
    respondBy: timestamp('respond_by', { withTimezone: true, mode: 'date' }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }),
    scheduledEndAt: timestamp('scheduled_end_at', { withTimezone: true, mode: 'date' }),
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
    /**
     * When the order entered DISPUTED, which starts the payout objection window.
     * The settlement itself is recorded by the escrow row and the ledger, so this
     * only ever names the start of reconciliation.
     */
    disputedAt: timestamp('disputed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    // A party can hold several future bookings and several open requests: what
    // they cannot do is be in two sessions at the same instant. Slot overlap is
    // a range question, which a unique index cannot ask, so `orders.service`
    // settles it inside a transaction that locks both parties' user rows. This
    // index stays as the hard floor for LIVE, where the race is real and the
    // money has already moved.
    uniqueIndex('orders_one_live_per_hirer')
      .on(t.hirerId)
      .where(sql`${t.status} in (${STATUS_LIST(LIVE_ORDER_STATUSES)})`),
    uniqueIndex('orders_one_live_per_player')
      .on(t.playerId)
      .where(sql`${t.status} in (${STATUS_LIST(LIVE_ORDER_STATUSES)})`),
    index('orders_hirer_idx').on(t.hirerId, t.createdAt),
    index('orders_player_idx').on(t.playerId, t.createdAt),
    index('orders_status_idx').on(t.status, t.respondBy),
    index('orders_disputed_idx').on(t.disputedAt),
    index('orders_player_starts_idx').on(t.playerId, t.startsAt),
    index('orders_hirer_starts_idx').on(t.hirerId, t.startsAt),
    check('orders_hours_check', sql`${t.hours} between 1 and 12`),
    check('orders_total_price_check', sql`${t.totalPrice} >= 0`),
    check('orders_fee_check', sql`${t.feeBps} between 0 and 5000`),
    check('orders_payout_check', sql`${t.playerPayout} is null or ${t.playerPayout} between 0 and ${t.totalPrice}`),
    check('orders_distinct_parties_check', sql`${t.hirerId} <> ${t.playerId}`),
    check(
      'orders_close_reason_check',
      sql`${t.status} <> 'CLOSED' or ${t.closeReason} is not null`,
    ),
    check(
      'orders_ended_early_by_check',
      sql`${t.status} <> 'ENDED_EARLY' or ${t.endedEarlyBy} is not null`,
    ),
    check('orders_disputed_at_check', sql`${t.status} <> 'DISPUTED' or ${t.disputedAt} is not null`),
    // A booked session without its slot is not a booking, and the calendar
    // overlap check reads exactly these two columns.
    check(
      'orders_slot_check',
      sql`${t.status} <> 'SCHEDULED' or (${t.startsAt} is not null and ${t.scheduledEndAt} is not null)`,
    ),
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
