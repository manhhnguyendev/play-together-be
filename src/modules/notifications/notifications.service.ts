import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import { DB, type AppDatabase, type DbExecutor } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { offsetOf, paginated, type Paginated } from '../../common/pagination/pagination';
import { Clock } from '../../common/time/time';
import { notifications, users } from '../../db/schema';
import type { NotificationDto } from './notifications.dto';

export type SendNotificationInput = {
  userId: string;
  title: string;
  body: string;
  referenceUrl?: string;
};

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly clock: Clock,
  ) {}

  async send(executor: DbExecutor, input: SendNotificationInput): Promise<void> {
    await executor.insert(notifications).values({
      userId: input.userId,
      title: input.title.slice(0, 200),
      body: input.body.slice(0, 1000),
      referenceUrl: input.referenceUrl ?? null,
    });
  }

  async sendMany(executor: DbExecutor, inputs: SendNotificationInput[]): Promise<void> {
    if (inputs.length === 0) return;
    await executor.insert(notifications).values(
      inputs.map((input) => ({
        userId: input.userId,
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 1000),
        referenceUrl: input.referenceUrl ?? null,
      })),
    );
  }

  async broadcast(title: string, body: string, referenceUrl?: string): Promise<number> {
    const recipients = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isActive, true));

    if (recipients.length === 0) return 0;

    await this.sendMany(
      this.db,
      recipients.map((recipient) => ({ userId: recipient.id, title, body, referenceUrl })),
    );
    return recipients.length;
  }

  async list(
    userId: string,
    page: number,
    pageSize: number,
    status?: 'UNREAD' | 'READ',
  ): Promise<Paginated<NotificationDto>> {
    const where = status
      ? and(eq(notifications.userId, userId), eq(notifications.status, status))
      : eq(notifications.userId, userId);

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select()
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt))
        .limit(pageSize)
        .offset(offsetOf(page, pageSize)),
      this.db.select({ value: count() }).from(notifications).where(where),
    ]);

    return paginated(rows.map(toNotificationDto), totalRow?.value ?? 0, page, pageSize);
  }

  async unreadCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.status, 'UNREAD')));
    return row?.value ?? 0;
  }

  async markRead(userId: string, id: string): Promise<NotificationDto> {
    const [row] = await this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .limit(1);

    if (!row) throw AppError.notFound(ErrorCode.notificationNotFound, 'Notification not found');
    if (row.status === 'READ') return toNotificationDto(row);

    const [updated] = await this.db
      .update(notifications)
      .set({ status: 'READ', readAt: this.clock.now() })
      .where(eq(notifications.id, id))
      .returning();

    return toNotificationDto(updated);
  }

  async markAllRead(userId: string): Promise<number> {
    const updated = await this.db
      .update(notifications)
      .set({ status: 'READ', readAt: this.clock.now() })
      .where(and(eq(notifications.userId, userId), eq(notifications.status, 'UNREAD')))
      .returning({ id: notifications.id });

    return updated.length;
  }

  async remove(userId: string, id: string): Promise<void> {
    const deleted = await this.db
      .delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning({ id: notifications.id });

    if (deleted.length === 0) {
      throw AppError.notFound(ErrorCode.notificationNotFound, 'Notification not found');
    }
  }

  async removeAllRead(userId: string): Promise<number> {
    const deleted = await this.db
      .delete(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.status, 'READ')))
      .returning({ id: notifications.id });
    return deleted.length;
  }
}

function toNotificationDto(row: typeof notifications.$inferSelect): NotificationDto {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    referenceUrl: row.referenceUrl,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}
