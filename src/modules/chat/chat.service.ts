import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, or } from 'drizzle-orm';
import { DB, type AppDatabase } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { offsetOf, paginated, type Paginated } from '../../common/pagination/pagination';
import { chats, users } from '../../db/schema';
import { toUserSummary } from '../users/user.mapper';
import { UsersService } from '../users/users.service';
import type { ChatMessageView, ConversationView } from './chat.dto';

const RECALLED_TEXT = 'This message was recalled';

@Injectable()
export class ChatService {
  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly usersService: UsersService,
  ) {}

  async send(senderId: string, receiverId: string, message: string): Promise<ChatMessageView> {
    if (senderId === receiverId) {
      throw AppError.badRequest(ErrorCode.cannotMessageSelf, 'You cannot message yourself');
    }

    const receiver = await this.usersService.findById(receiverId);
    if (!receiver) throw AppError.notFound(ErrorCode.userNotFound, 'Recipient not found');
    if (!receiver.isActive) throw AppError.badRequest(ErrorCode.userNotActive, 'This account is locked');

    if (await this.usersService.isBlockedEitherWay(senderId, receiverId)) {
      throw AppError.forbidden(ErrorCode.messageBlocked, 'You cannot message this user');
    }

    const [row] = await this.db
      .insert(chats)
      .values({ senderId, receiverId, message })
      .returning();

    return this.map(row, senderId);
  }

  async conversation(userId: string, otherId: string, page: number, pageSize: number): Promise<Paginated<ChatMessageView>> {
    if (userId === otherId) {
      throw AppError.badRequest(ErrorCode.cannotMessageSelf, 'A conversation requires another user');
    }

    const other = await this.usersService.findById(otherId);
    if (!other) throw AppError.notFound(ErrorCode.userNotFound, 'User not found');

    const where = or(
      and(eq(chats.senderId, userId), eq(chats.receiverId, otherId)),
      and(eq(chats.senderId, otherId), eq(chats.receiverId, userId)),
    );

    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(chats)
        .where(where)
        .orderBy(desc(chats.createdAt))
        .limit(pageSize)
        .offset(offsetOf(page, pageSize)),
      this.db.select({ value: count() }).from(chats).where(where),
    ]);

    return paginated(
      rows.map((row) => this.map(row, userId)),
      total?.value ?? 0,
      page,
      pageSize,
    );
  }

  async conversations(userId: string): Promise<ConversationView[]> {
    const rows = await this.db
      .select()
      .from(chats)
      .where(or(eq(chats.senderId, userId), eq(chats.receiverId, userId)))
      .orderBy(desc(chats.createdAt))
      .limit(500);

    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const counterpart = row.senderId === userId ? row.receiverId : row.senderId;
      if (!latest.has(counterpart)) latest.set(counterpart, row);
    }

    if (latest.size === 0) return [];

    const counterpartIds = [...latest.keys()];
    const people = await this.db.select().from(users).where(inArray(users.id, counterpartIds));
    const peopleById = new Map(people.map((person) => [person.id, person]));

    const result: ConversationView[] = [];
    for (const [counterpartId, message] of latest) {
      const person = peopleById.get(counterpartId);
      if (!person) continue;
      result.push({
        user: toUserSummary(person),
        lastMessage: this.map(message, userId),
        updatedAt: message.createdAt.toISOString(),
      });
    }

    return result;
  }

  async recall(userId: string, chatId: string): Promise<ChatMessageView> {
    const [row] = await this.db.select().from(chats).where(eq(chats.id, chatId)).limit(1);
    if (!row || (row.senderId !== userId && row.receiverId !== userId)) {
      throw AppError.notFound(ErrorCode.messageNotFound, 'Message not found');
    }
    if (row.senderId !== userId) {
      throw AppError.forbidden(ErrorCode.forbidden, 'Only the sender can recall this message');
    }
    if (row.isRecalled) return this.map(row, userId);

    const [updated] = await this.db
      .update(chats)
      .set({ isRecalled: true })
      .where(eq(chats.id, chatId))
      .returning();

    return this.map(updated, userId);
  }

  private map(row: typeof chats.$inferSelect, viewerId: string): ChatMessageView {
    return {
      id: row.id,
      senderId: row.senderId,
      receiverId: row.receiverId,
      message: row.isRecalled ? RECALLED_TEXT : row.message,
      isRecalled: row.isRecalled,
      mine: row.senderId === viewerId,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
