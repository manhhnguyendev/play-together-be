import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, exists, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { DB, type AppDatabase } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { offsetOf, paginated, type Paginated } from '../../common/pagination/pagination';
import {
  gameRanks,
  games,
  gameTypeLinks,
  gameTypes,
  orderGames,
  userFavorites,
  userSkills,
  type Game,
  type GameRank,
  type GameType,
} from '../../db/schema';
import type {
  CreateGameDto,
  CreateGameTypeDto,
  CreateRankDto,
  FavoriteGameDto,
  GameDetail,
  GameTypeDetail,
  GameTypeView,
  GameView,
  ListGamesQuery,
  UpdateGameDto,
  UpdateGameTypeDto,
  UpdateRankDto,
} from './catalog.dto';

@Injectable()
export class CatalogService {
  constructor(@Inject(DB) private readonly db: AppDatabase) {}

  async mostFavorited(limit: number): Promise<FavoriteGameDto[]> {
    const rows = await this.db
      .select({
        id: games.id,
        name: games.name,
        displayName: games.displayName,
        favoriteCount: sql<number>`count(${userFavorites.userId})`,
      })
      .from(games)
      .leftJoin(userFavorites, eq(userFavorites.gameId, games.id))
      .groupBy(games.id, games.name, games.displayName)
      .orderBy(desc(sql`count(${userFavorites.userId})`), asc(games.name))
      .limit(limit);

    return rows.map((row) => ({ ...row, favoriteCount: Number(row.favoriteCount) }));
  }

  async listGames(query: ListGamesQuery): Promise<Paginated<GameView>> {    const conditions: SQL[] = [];
    if (query.q) {
      const pattern = `%${query.q}%`;
      conditions.push(
        or(ilike(games.name, pattern), ilike(games.displayName, pattern), ilike(games.otherNames, pattern))!,
      );
    }
    if (query.gameTypeId) {
      conditions.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(gameTypeLinks)
            .where(
              and(
                eq(gameTypeLinks.gameId, games.id),
                eq(gameTypeLinks.gameTypeId, query.gameTypeId),
              ),
            ),
        ),
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(games)
        .where(where)
        .orderBy(asc(games.name))
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(games).where(where),
    ]);

    const typesByGame = await this.typesFor(rows.map((row) => row.id));

    return paginated(
      rows.map((row) => ({ ...row, types: typesByGame.get(row.id) ?? [] })),
      total?.value ?? 0,
      query.page,
      query.pageSize,
    );
  }

  async getGame(id: string): Promise<GameDetail> {
    const [game] = await this.db.select().from(games).where(eq(games.id, id)).limit(1);
    if (!game) throw AppError.notFound(ErrorCode.gameNotFound, 'Game not found');

    const [types, ranks] = await Promise.all([
      this.typesFor([game.id]),
      this.db
        .select({ id: gameRanks.id, no: gameRanks.no, name: gameRanks.name })
        .from(gameRanks)
        .where(eq(gameRanks.gameId, game.id))
        .orderBy(asc(gameRanks.no)),
    ]);

    return { ...game, types: types.get(game.id) ?? [], ranks };
  }

  async listRanks(gameId: string): Promise<Array<{ id: string; no: number; name: string }>> {
    const [game] = await this.db.select({ id: games.id }).from(games).where(eq(games.id, gameId)).limit(1);
    if (!game) throw AppError.notFound(ErrorCode.gameNotFound, 'Game not found');

    return this.db
      .select({ id: gameRanks.id, no: gameRanks.no, name: gameRanks.name })
      .from(gameRanks)
      .where(eq(gameRanks.gameId, gameId))
      .orderBy(asc(gameRanks.no));
  }

  async createGame(dto: CreateGameDto): Promise<GameDetail> {
    const typeIds = dto.gameTypeIds ?? [];
    await this.assertGameTypesExist(typeIds);

    const game = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(games)
        .values({
          name: dto.name,
          displayName: dto.displayName ?? null,
          otherNames: dto.otherNames ?? null,
        })
        .returning();

      if (typeIds.length > 0) {
        await tx.insert(gameTypeLinks).values(typeIds.map((gameTypeId) => ({ gameId: created.id, gameTypeId })));
      }
      return created;
    });

    return this.getGame(game.id);
  }

  async updateGame(id: string, dto: UpdateGameDto): Promise<GameDetail> {
    await this.requireGame(id);
    if (dto.gameTypeIds) await this.assertGameTypesExist(dto.gameTypeIds);

    await this.db.transaction(async (tx) => {
      const patch: Partial<typeof games.$inferInsert> = { updatedAt: new Date() };
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.displayName !== undefined) patch.displayName = dto.displayName;
      if (dto.otherNames !== undefined) patch.otherNames = dto.otherNames;
      await tx.update(games).set(patch).where(eq(games.id, id));

      if (dto.gameTypeIds) {
        await tx.delete(gameTypeLinks).where(eq(gameTypeLinks.gameId, id));
        if (dto.gameTypeIds.length > 0) {
          await tx.insert(gameTypeLinks).values(dto.gameTypeIds.map((gameTypeId) => ({ gameId: id, gameTypeId })));
        }
      }
    });

    return this.getGame(id);
  }

  async removeGame(id: string): Promise<void> {
    await this.requireGame(id);

    const [used] = await this.db
      .select({ one: sql`1` })
      .from(orderGames)
      .where(eq(orderGames.gameId, id))
      .limit(1);

    if (used) {
      throw AppError.conflict(
        ErrorCode.conflict,
        'This game is referenced by existing orders and cannot be deleted; hide or rename it instead',
      );
    }

    await this.db.delete(games).where(eq(games.id, id));
  }

  async listGameTypes(input: { page: number; pageSize: number; q?: string }): Promise<Paginated<GameTypeView>> {
    const where = input.q ? ilike(gameTypes.name, `%${input.q}%`) : undefined;

    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(gameTypes)
        .where(where)
        .orderBy(asc(gameTypes.name))
        .limit(input.pageSize)
        .offset(offsetOf(input.page, input.pageSize)),
      this.db.select({ value: count() }).from(gameTypes).where(where),
    ]);

    const counts = rows.length
      ? await this.db
          .select({ gameTypeId: gameTypeLinks.gameTypeId, value: count() })
          .from(gameTypeLinks)
          .where(inArray(gameTypeLinks.gameTypeId, rows.map((row) => row.id)))
          .groupBy(gameTypeLinks.gameTypeId)
      : [];

    const countByType = new Map(counts.map((row) => [row.gameTypeId, Number(row.value)]));

    return paginated(
      rows.map((row) => ({ ...row, gameCount: countByType.get(row.id) ?? 0 })),
      total?.value ?? 0,
      input.page,
      input.pageSize,
    );
  }

  async getGameType(id: string): Promise<GameTypeDetail> {
    const [row] = await this.db.select().from(gameTypes).where(eq(gameTypes.id, id)).limit(1);
    if (!row) throw AppError.notFound(ErrorCode.gameTypeNotFound, 'Game type not found');

    const linked = await this.db
      .select({ game: games })
      .from(gameTypeLinks)
      .innerJoin(games, eq(games.id, gameTypeLinks.gameId))
      .where(eq(gameTypeLinks.gameTypeId, id))
      .orderBy(asc(games.name));

    return { ...row, gameCount: linked.length, games: linked.map((item) => item.game) };
  }

  async createGameType(dto: CreateGameTypeDto): Promise<GameTypeView> {
    const [created] = await this.db
      .insert(gameTypes)
      .values({
        name: dto.name,
        shortName: dto.shortName ?? null,
        description: dto.description ?? null,
      })
      .returning();
    return { ...created, gameCount: 0 };
  }

  async updateGameType(id: string, dto: UpdateGameTypeDto): Promise<GameTypeView> {
    const [existing] = await this.db.select().from(gameTypes).where(eq(gameTypes.id, id)).limit(1);
    if (!existing) throw AppError.notFound(ErrorCode.gameTypeNotFound, 'Game type not found');

    const patch: Partial<typeof gameTypes.$inferInsert> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.shortName !== undefined) patch.shortName = dto.shortName;
    if (dto.description !== undefined) patch.description = dto.description;

    const [updated] = await this.db.update(gameTypes).set(patch).where(eq(gameTypes.id, id)).returning();
    return this.getGameType(updated.id);
  }

  async removeGameType(id: string): Promise<void> {
    const deleted = await this.db.delete(gameTypes).where(eq(gameTypes.id, id)).returning({ id: gameTypes.id });
    if (deleted.length === 0) throw AppError.notFound(ErrorCode.gameTypeNotFound, 'Game type not found');
  }

  async createRank(gameId: string, dto: CreateRankDto): Promise<GameRank> {
    await this.requireGame(gameId);

    const [created] = await this.db
      .insert(gameRanks)
      .values({ gameId, no: dto.no, name: dto.name })
      .returning();
    return created;
  }

  async updateRank(rankId: string, dto: UpdateRankDto): Promise<GameRank> {
    const [existing] = await this.db.select().from(gameRanks).where(eq(gameRanks.id, rankId)).limit(1);
    if (!existing) throw AppError.notFound(ErrorCode.rankNotFound, 'Rank not found');

    const [updated] = await this.db
      .update(gameRanks)
      .set({
        ...(dto.no !== undefined ? { no: dto.no } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
      })
      .where(eq(gameRanks.id, rankId))
      .returning();
    return updated;
  }

  async removeRank(rankId: string): Promise<void> {
    const [used] = await this.db
      .select({ one: sql`1` })
      .from(userSkills)
      .where(eq(userSkills.rankId, rankId))
      .limit(1);

    if (used) {
      throw AppError.conflict(
        ErrorCode.rankInUse,
        'This rank is assigned to player skills and cannot be deleted',
      );
    }

    const deleted = await this.db.delete(gameRanks).where(eq(gameRanks.id, rankId)).returning({ id: gameRanks.id });
    if (deleted.length === 0) throw AppError.notFound(ErrorCode.rankNotFound, 'Rank not found');
  }

  private async typesFor(
    gameIds: string[],
  ): Promise<Map<string, Array<{ id: string; name: string; shortName: string | null }>>> {
    const map = new Map<string, Array<{ id: string; name: string; shortName: string | null }>>();
    if (gameIds.length === 0) return map;

    const rows = await this.db
      .select({
        gameId: gameTypeLinks.gameId,
        id: gameTypes.id,
        name: gameTypes.name,
        shortName: gameTypes.shortName,
      })
      .from(gameTypeLinks)
      .innerJoin(gameTypes, eq(gameTypes.id, gameTypeLinks.gameTypeId))
      .where(inArray(gameTypeLinks.gameId, gameIds))
      .orderBy(asc(gameTypes.name));

    for (const row of rows) {
      const list = map.get(row.gameId) ?? [];
      list.push({ id: row.id, name: row.name, shortName: row.shortName });
      map.set(row.gameId, list);
    }
    return map;
  }

  private async requireGame(id: string): Promise<Game> {
    const [game] = await this.db.select().from(games).where(eq(games.id, id)).limit(1);
    if (!game) throw AppError.notFound(ErrorCode.gameNotFound, 'Game not found');
    return game;
  }

  private async assertGameTypesExist(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const rows = await this.db
      .select({ id: gameTypes.id })
      .from(gameTypes)
      .where(inArray(gameTypes.id, ids));

    if (rows.length !== new Set(ids).size) {
      throw AppError.badRequest(ErrorCode.gameTypeNotFound, 'One or more game types do not exist');
    }
  }
}
