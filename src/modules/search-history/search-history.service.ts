import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { DB, type AppDatabase } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { Clock, MS_DAY } from '../../common/time/time';
import { searchHistory } from '../../db/schema';
import type { HotSearchItemDto, SearchHistoryItem } from './search-history.dto';

const HOT_WINDOW_DAYS = 30;

@Injectable()
export class SearchHistoryService {
  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly clock: Clock,
  ) {}

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

  /** Trending player searches across all accounts, never exposing who searched. */
  async hot(limit: number): Promise<HotSearchItemDto[]> {
    const since = new Date(this.clock.now().getTime() - HOT_WINDOW_DAYS * MS_DAY);
    const normalized = sql`lower(${searchHistory.query})`;

    const rows = await this.db
      .select({
        query: sql<string>`min(${searchHistory.query})`,
        searches: sql<number>`count(distinct ${searchHistory.userId})`,
      })
      .from(searchHistory)
      .where(gte(searchHistory.createdAt, since))
      .groupBy(normalized)
      .orderBy(desc(sql`count(distinct ${searchHistory.userId})`), asc(sql`min(${searchHistory.query})`))
      .limit(limit);

    return rows.map((row) => ({ query: row.query, searches: Number(row.searches) }));
  }

  private map(row: typeof searchHistory.$inferSelect): SearchHistoryItem {
    return { id: row.id, query: row.query, createdAt: row.createdAt.toISOString() };
  }
}
