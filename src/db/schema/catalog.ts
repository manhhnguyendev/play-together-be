import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    displayName: varchar('display_name', { length: 100 }),
    otherNames: text('other_names'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('games_name_key').on(sql`lower(${t.name})`)],
);

export const gameTypes = pgTable(
  'game_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    shortName: varchar('short_name', { length: 50 }),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('game_types_name_key').on(sql`lower(${t.name})`)],
);

export const gameRanks = pgTable(
  'game_ranks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    no: smallint('no').notNull(),
    name: varchar('name', { length: 50 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('game_ranks_game_no_key').on(t.gameId, t.no),
    check('game_ranks_no_check', sql`${t.no} between 1 and 100`),
  ],
);

export const gameTypeLinks = pgTable(
  'game_type_links',
  {
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    gameTypeId: uuid('game_type_id')
      .notNull()
      .references(() => gameTypes.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.gameTypeId] })],
);

export const userSkills = pgTable(
  'user_skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    rankId: uuid('rank_id').references(() => gameRanks.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('user_skills_user_game_key').on(t.userId, t.gameId), index('user_skills_game_idx').on(t.gameId)],
);

export const userHobbies = pgTable(
  'user_hobbies',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.gameId] }), index('user_hobbies_game_idx').on(t.gameId)],
);

export const userFavorites = pgTable(
  'user_favorites',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.gameId] }),
    index('user_favorites_game_idx').on(t.gameId),
  ],
);

export const userImages = pgTable(  'user_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('user_images_user_idx').on(t.userId)],
);

export const availabilityWindows = pgTable(
  'availability_windows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dayOfWeek: smallint('day_of_week').notNull(),
    startMinute: smallint('start_minute').notNull(),
    endMinute: smallint('end_minute').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('availability_windows_user_idx').on(t.userId),
    check('availability_day_check', sql`${t.dayOfWeek} between 1 and 7`),
    check('availability_start_check', sql`${t.startMinute} between 0 and 1439`),
    check('availability_end_check', sql`${t.endMinute} between 1 and 1440`),
    check('availability_range_check', sql`${t.startMinute} < ${t.endMinute}`),
  ],
);

export type Game = typeof games.$inferSelect;
export type GameRank = typeof gameRanks.$inferSelect;
export type GameType = typeof gameTypes.$inferSelect;
export type UserSkill = typeof userSkills.$inferSelect;
export type AvailabilityWindow = typeof availabilityWindows.$inferSelect;
