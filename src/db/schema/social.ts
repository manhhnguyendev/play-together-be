import { sql } from 'drizzle-orm';
import {
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
import { feedbackTypeEnum, moderationStatusEnum, notificationStatusEnum } from './enums';
import { users } from './users';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    body: varchar('body', { length: 1000 }).notNull(),
    referenceUrl: text('reference_url'),
    status: notificationStatusEnum('status').notNull().default('UNREAD'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.status, t.createdAt)],
);

export const chats = pgTable(
  'chats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    receiverId: uuid('receiver_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    message: varchar('message', { length: 2000 }).notNull(),
    isRecalled: boolean('is_recalled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('chats_sender_idx').on(t.senderId, t.createdAt),
    index('chats_receiver_idx').on(t.receiverId, t.createdAt),
    check('chats_parties_check', sql`${t.senderId} <> ${t.receiverId}`),
  ],
);

export const userBlocks = pgTable(
  'user_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedUserId: uuid('blocked_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_blocks_pair_key').on(t.userId, t.blockedUserId),
    check('user_blocks_parties_check', sql`${t.userId} <> ${t.blockedUserId}`),
  ],
);

export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    message: varchar('message', { length: 2000 }).notNull(),
    type: feedbackTypeEnum('type').notNull().default('OTHER'),
    status: moderationStatusEnum('status').notNull().default('PENDING'),
    adminNote: text('admin_note'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('feedback_status_idx').on(t.status, t.createdAt), index('feedback_user_idx').on(t.userId)],
);

export const searchHistory = pgTable(
  'search_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    query: varchar('query', { length: 200 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('search_history_user_query_key').on(t.userId, sql`lower(${t.query})`),
    index('search_history_user_idx').on(t.userId, t.createdAt),
  ],
);
