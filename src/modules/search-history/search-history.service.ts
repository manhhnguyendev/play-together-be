import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DB, type AppDatabase } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { searchHistory } from '../../db/schema';
import type { SearchHistoryItem } from './search-history.dto';

@Injectable()
export class SearchHistoryService {
  constructor(@Inject(DB) private readonly db: AppDatabase) {}

  async record(userId: string, query: string): Promise<SearchHistoryItem> {
    const normalized = query.trim();

    return this.db.transaction(async (tx) => {
      await tx
        .delete(searchHistory)
        .where(and(eq(searchHistory.userId, userId), sql`lower(${searchHistory.query}) = lower(${normalized})`));

      const [row] = await tx
        .insert(searchHistory)
        .values({ userId, query: normalized })
        .returning();

      return this.map(row);
    });
  }

  async list(userId: string, limit: number): Promise<SearchHistoryItem[]> {
    const rows = await this.db
      .select()
      .from(searchHistory)
      .where(eq(searchHistory.userId, userId))
      .orderBy(desc(searchHistory.createdAt))
      .limit(limit);

    return rows.map((row) => this.map(row));
  }

  async remove(userId: string, id: string): Promise<void> {
    const [row] = await this.db
      .select({ id: searchHistory.id })
      .from(searchHistory)
      .where(and(eq(searchHistory.id, id), eq(searchHistory.userId, userId)))
      .limit(1);
    if (!row) throw AppError.notFound(ErrorCode.notFound, 'Search history entry not found');
    await this.db.delete(searchHistory).where(eq(searchHistory.id, id));
  }

  async clear(userId: string): Promise<void> {
    await this.db.delete(searchHistory).where(eq(searchHistory.userId, userId));
  }

  private map(row: typeof searchHistory.$inferSelect): SearchHistoryItem {
    return { id: row.id, query: row.query, createdAt: row.createdAt.toISOString() };
  }
}
