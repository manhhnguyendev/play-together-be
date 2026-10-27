import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import { DB, type AppDatabase } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { offsetOf, paginated, type Paginated } from '../../common/pagination/pagination';
import { feedback } from '../../db/schema';
import type { CreateFeedbackDto, ListMyFeedbackQuery, MyFeedbackView } from './feedback.dto';

@Injectable()
export class FeedbackService {
  constructor(@Inject(DB) private readonly db: AppDatabase) {}

  async create(userId: string, dto: CreateFeedbackDto): Promise<MyFeedbackView> {
    const [row] = await this.db
      .insert(feedback)
      .values({ userId, title: dto.title, message: dto.message, type: dto.type })
      .returning();

    return this.map(row);
  }

  async listMine(userId: string, query: ListMyFeedbackQuery): Promise<Paginated<MyFeedbackView>> {
    const where = query.status
      ? and(eq(feedback.userId, userId), eq(feedback.status, query.status))
      : eq(feedback.userId, userId);

    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(feedback)
        .where(where)
        .orderBy(desc(feedback.createdAt))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(feedback).where(where),
    ]);

    return paginated(rows.map((row) => this.map(row)), total?.value ?? 0, query.page, query.pageSize);
  }

  async getMine(userId: string, id: string): Promise<MyFeedbackView> {
    const [row] = await this.db
      .select()
      .from(feedback)
      .where(and(eq(feedback.id, id), eq(feedback.userId, userId)))
      .limit(1);
    if (!row) throw AppError.notFound(ErrorCode.notFound, 'Feedback not found');
    return this.map(row);
  }

  private map(row: typeof feedback.$inferSelect): MyFeedbackView {
    return {
      id: row.id,
      title: row.title,
      message: row.message,
      type: row.type,
      status: row.status,
      adminNote: row.adminNote,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
