import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, notInArray, or, sql } from 'drizzle-orm';
import { DB, type AppDatabase } from '../../common/database/database.module';
import { Clock } from '../../common/time/time';
import { games, searchHistory, userBlocks, userHobbies, userSkills, users } from '../../db/schema';
import { toUserSummary } from '../users/user.mapper';
import type { RecommendationView } from './recommendations.dto';

/**
 * Content-based recommender that replaces the original ML.NET call. It builds a
 * preference profile from the hirer's hobbies and recent searches, then scores
 * players by how many of those games they offer. Ranking points break ties and
 * fill the remaining slots, so the endpoint always has a useful answer.
 */
@Injectable()
export class RecommendationsService {
  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly clock: Clock,
  ) {}

  async forUser(userId: string, limit: number): Promise<RecommendationView[]> {
    const now = this.clock.now();
    const preferenceIds = await this.preferenceGameIds(userId);
    const excluded = await this.excludedUserIds(userId, now);

    interface Candidate {
      player: typeof users.$inferSelect;
      score: number;
    }

    const candidates: Candidate[] = [];
    const seen = new Set<string>(excluded);

    if (preferenceIds.length > 0) {
      const rows = await this.db
        .select({
          player: users,
          score: sql<number>`count(distinct ${userSkills.gameId})`,
        })
        .from(users)
        .innerJoin(userSkills, eq(userSkills.userId, users.id))
        .where(
          and(
            eq(users.isActive, true),
            eq(users.isPlayer, true),
            notInArray(users.id, excluded),
            inArray(userSkills.gameId, preferenceIds),
          ),
        )
        .groupBy(users.id)
        .orderBy(
          desc(sql`count(distinct ${userSkills.gameId})`),
          desc(users.rankingPoints),
          desc(users.ratingSum),
        )
        .limit(limit);

      for (const row of rows) {
        candidates.push({ player: row.player, score: Number(row.score) });
        seen.add(row.player.id);
      }
    }

    if (candidates.length < limit) {
      const fill = await this.db
        .select()
        .from(users)
        .where(
          and(
            eq(users.isActive, true),
            eq(users.isPlayer, true),
            notInArray(users.id, [...seen]),
          ),
        )
        .orderBy(desc(users.rankingPoints), desc(users.ratingSum))
        .limit(limit - candidates.length);

      for (const player of fill) {
        candidates.push({ player, score: 0 });
        seen.add(player.id);
      }
    }

    if (candidates.length === 0) return [];

    const matches = await this.matchedGames(
      candidates.map((candidate) => candidate.player.id),
      preferenceIds,
    );

    return candidates.map((candidate) => {
      const matched = matches.get(candidate.player.id) ?? [];
      return {
        user: toUserSummary(candidate.player),
        score: candidate.score,
        matchedGames: matched,
        reason:
          matched.length > 0
            ? `Offers ${matched.map((game) => game.name).join(', ')}`
            : 'Top-ranked player on PlayTogether',
      };
    });
  }

  private async preferenceGameIds(userId: string): Promise<string[]> {
    const hobbyRows = await this.db
      .select({ gameId: userHobbies.gameId })
      .from(userHobbies)
      .where(eq(userHobbies.userId, userId));

    const ids = new Set(hobbyRows.map((row) => row.gameId));

    const searches = await this.db
      .select({ query: searchHistory.query })
      .from(searchHistory)
      .where(eq(searchHistory.userId, userId))
      .orderBy(desc(searchHistory.createdAt))
      .limit(10);

    if (searches.length > 0) {
      const searchFilters = searches.flatMap((entry) => {
        const pattern = `%${entry.query}%`;
        return [
          ilike(games.name, pattern),
          ilike(games.displayName, pattern),
          ilike(games.otherNames, pattern),
        ];
      });

      const matchedGames = await this.db
        .select({ id: games.id })
        .from(games)
        .where(or(...searchFilters))
        .limit(50);

      for (const game of matchedGames) ids.add(game.id);
    }

    return [...ids];
  }

  private async excludedUserIds(userId: string, now: Date): Promise<string[]> {
    const blocks = await this.db
      .select({
        userId: userBlocks.userId,
        blockedUserId: userBlocks.blockedUserId,
        expiresAt: userBlocks.expiresAt,
      })
      .from(userBlocks)
      .where(or(eq(userBlocks.userId, userId), eq(userBlocks.blockedUserId, userId)));

    const excluded = new Set<string>([userId]);
    for (const block of blocks) {
      if (block.expiresAt && block.expiresAt.getTime() <= now.getTime()) continue;
      excluded.add(block.userId === userId ? block.blockedUserId : block.userId);
    }

    return [...excluded];
  }

  private async matchedGames(
    playerIds: string[],
    preferenceIds: string[],
  ): Promise<Map<string, Array<{ id: string; name: string }>>> {
    const result = new Map<string, Array<{ id: string; name: string }>>();
    if (preferenceIds.length === 0 || playerIds.length === 0) return result;

    const rows = await this.db
      .select({ userId: userSkills.userId, id: games.id, name: games.name })
      .from(userSkills)
      .innerJoin(games, eq(games.id, userSkills.gameId))
      .where(and(inArray(userSkills.userId, playerIds), inArray(userSkills.gameId, preferenceIds)));

    for (const row of rows) {
      const list = result.get(row.userId) ?? [];
      list.push({ id: row.id, name: row.name });
      result.set(row.userId, list);
    }

    return result;
  }
}
