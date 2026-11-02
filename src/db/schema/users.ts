import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { genderEnum, userRoleEnum, userStatusEnum, ADMIN_ROLES } from './enums';

/** Inlined as literals: a CHECK constraint cannot carry query parameters. */
const ADMIN_ROLE_SQL = ADMIN_ROLES.map((role) => `'${role}'`).join(', ');

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }),
    googleId: varchar('google_id', { length: 255 }),
    role: userRoleEnum('role').notNull().default('USER'),
    /**
     * Which part of the back office the account may use. Null means none —
     * every ordinary user, charity and past admin row.
     */
    adminRole: varchar('admin_role', { length: 16, enum: ADMIN_ROLES }),
    name: varchar('name', { length: 100 }).notNull(),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    city: varchar('city', { length: 100 }),
    gender: genderEnum('gender').notNull().default('OTHER'),
    avatarUrl: text('avatar_url'),
    bio: text('bio'),
    status: userStatusEnum('status').notNull().default('ONLINE'),
    isActive: boolean('is_active').notNull().default(true),
    isPlayer: boolean('is_player').notNull().default(false),
    pricePerHour: bigint('price_per_hour', { mode: 'number' }).notNull().default(10000),
    maxHoursPerHire: integer('max_hours_per_hire').notNull().default(1),
    ratingSum: integer('rating_sum').notNull().default(0),
    ratingCount: integer('rating_count').notNull().default(0),
    ordersCount: integer('orders_count').notNull().default(0),
    completedOrdersCount: integer('completed_orders_count').notNull().default(0),
    totalHours: integer('total_hours').notNull().default(0),
    onTimeCount: integer('on_time_count').notNull().default(0),
    rankingPoints: integer('ranking_points').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(sql`lower(${t.email})`),
    uniqueIndex('users_google_id_key')
      .on(t.googleId)
      .where(sql`${t.googleId} is not null`),
    index('users_player_search_idx').on(t.isPlayer, t.status, t.ratingSum),
    index('users_role_idx').on(t.role),
    index('users_admin_role_idx').on(t.adminRole),
    check('users_price_per_hour_check', sql`${t.pricePerHour} >= 0`),
    check('users_max_hours_check', sql`${t.maxHoursPerHire} between 1 and 12`),
    check('users_rating_count_check', sql`${t.ratingCount} >= 0`),
    check('users_rating_sum_check', sql`${t.ratingSum} between 0 and ${t.ratingCount} * 5`),
    check('users_ranking_points_check', sql`${t.rankingPoints} >= 0`),
    check(
      'users_admin_role_check',
      sql`${t.adminRole} is null or ${t.adminRole} in (${sql.raw(ADMIN_ROLE_SQL)})`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
