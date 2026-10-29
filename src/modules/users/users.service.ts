import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DB, type AppDatabase } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { MAX_PRICE_PER_HOUR, MIN_PRICE_PER_HOUR } from '../../common/money/money';
import { offsetOf, paginated, type Paginated } from '../../common/pagination/pagination';
import { addHours, isWithinAvailability, Clock } from '../../common/time/time';
import {
  availabilityWindows,
  behaviorPoints,
  gameRanks,
  games,
  gameTypeLinks,
  orders,
  userBlocks,
  userFavorites,
  userHobbies,
  userImages,
  userSkills,
  users,
  type User,
} from '../../db/schema';
import { toUserSummary } from './user.mapper';
import { StatsService } from './stats.service';
import type {
  AddFavoriteDto,
  AddHobbyDto,
  AddImageDto,
  BlockUserDto,
  CreateAvailabilityDto,
  FavoriteGameItemDto,
  PlayerModeDto,
  SearchPlayersQuery,
  UpdateAvailabilityDto,
  UpdateProfileDto,
  UpsertSkillDto,
  UserProfile,
  UserSummary,
} from './users.dto';

const MAX_IMAGES = 10;

@Injectable()
export class UsersService {
  private readonly timeZone: string;

  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly stats: StatsService,
    private readonly clock: Clock,
    config: ConfigService,
  ) {
    this.timeZone = config.get<string>('APP_TIMEZONE') ?? 'Asia/Ho_Chi_Minh';
  }

  async findById(id: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }

  async requireById(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw AppError.notFound(ErrorCode.userNotFound, 'User not found');
    return user;
  }

  async requireActive(id: string): Promise<User> {
    const user = await this.requireById(id);
    if (!user.isActive) throw AppError.forbidden(ErrorCode.userNotActive, 'This account is locked');
    return user;
  }

  async getProfile(id: string, viewerId?: string): Promise<UserProfile> {
    const user = await this.requireById(id);
    const now = this.clock.now();

    const [behavior] = await this.db
      .select({ points: behaviorPoints.points, satisfaction: behaviorPoints.satisfaction })
      .from(behaviorPoints)
      .where(eq(behaviorPoints.userId, id))
      .limit(1);

    const [skillRows, hobbyRows, imageRows, availabilityRows] = await Promise.all([
      this.db
        .select({
          id: userSkills.id,
          gameId: games.id,
          gameName: games.name,
          gameDisplayName: games.displayName,
          rankId: gameRanks.id,
          rankNo: gameRanks.no,
          rankName: gameRanks.name,
        })
        .from(userSkills)
        .innerJoin(games, eq(games.id, userSkills.gameId))
        .leftJoin(gameRanks, eq(gameRanks.id, userSkills.rankId))
        .where(eq(userSkills.userId, id))
        .orderBy(asc(games.name)),
      this.db
        .select({ id: games.id, name: games.name, displayName: games.displayName })
        .from(userHobbies)
        .innerJoin(games, eq(games.id, userHobbies.gameId))
        .where(eq(userHobbies.userId, id))
        .orderBy(asc(games.name)),
      this.db.select().from(userImages).where(eq(userImages.userId, id)).orderBy(desc(userImages.createdAt)),
      this.db
        .select()
        .from(availabilityWindows)
        .where(eq(availabilityWindows.userId, id))
        .orderBy(asc(availabilityWindows.dayOfWeek), asc(availabilityWindows.startMinute)),
    ]);

    const blockedByMe = viewerId
      ? await this.isBlocked(viewerId, id, now)
      : false;

    const summary = toUserSummary(user, { includeEmail: viewerId === id });

    return {
      ...summary,
      ...(viewerId === id ? { isActive: user.isActive } : {}),
      dateOfBirth: viewerId === id ? user.dateOfBirth : null,
      behavior: {
        points: behavior?.points ?? 100,
        satisfaction: behavior?.satisfaction ?? 100,
      },
      skills: skillRows.map((row) => ({
        id: row.id,
        game: { id: row.gameId, name: row.gameName, displayName: row.gameDisplayName },
        rank: row.rankId && row.rankNo !== null && row.rankName !== null
          ? { id: row.rankId, no: row.rankNo, name: row.rankName }
          : null,
      })),
      hobbies: hobbyRows,
      images: imageRows.map((row) => ({ id: row.id, url: row.url, createdAt: row.createdAt.toISOString() })),
      availability: availabilityRows.map((row) => ({
        id: row.id,
        dayOfWeek: row.dayOfWeek,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
      })),
      isBlockedByMe: blockedByMe,
      canHire:
        viewerId !== undefined &&
        viewerId !== id &&
        user.isActive &&
        user.isPlayer &&
        (user.status === 'ONLINE' || user.status === 'OFFLINE') &&
        !blockedByMe,
    };
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<UserSummary> {
    const patch: Partial<typeof users.$inferInsert> = { updatedAt: this.clock.now() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.dateOfBirth !== undefined) patch.dateOfBirth = dto.dateOfBirth;
    if (dto.city !== undefined) patch.city = dto.city;
    if (dto.gender !== undefined) patch.gender = dto.gender;
    if (dto.avatarUrl !== undefined) patch.avatarUrl = dto.avatarUrl;
    if (dto.bio !== undefined) patch.bio = dto.bio;

    const [updated] = await this.db.update(users).set(patch).where(eq(users.id, id)).returning();
    if (!updated) throw AppError.notFound(ErrorCode.userNotFound, 'User not found');
    return toUserSummary(updated, { includeEmail: true });
  }

  async updateStatus(id: string, status: 'ONLINE' | 'OFFLINE' | 'BUSY'): Promise<UserSummary> {
    const user = await this.requireById(id);
    if (user.status === 'MAINTAIN') {
      throw AppError.conflict(ErrorCode.maintenanceMode, 'Account is in maintenance mode');
    }
    const [updated] = await this.db
      .update(users)
      .set({ status, updatedAt: this.clock.now() })
      .where(eq(users.id, id))
      .returning();
    return toUserSummary(updated, { includeEmail: true });
  }

  async setPlayerMode(id: string, dto: PlayerModeDto): Promise<UserSummary> {
    const user = await this.requireById(id);

    if (!dto.enabled) {
      const [active] = await this.db
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.playerId, id),
            or(eq(orders.status, 'PROCESSING'), eq(orders.status, 'ACCEPTED')),
          ),
        )
        .limit(1);

      if (active) {
        throw AppError.conflict(ErrorCode.activeOrderExists, 'Finish your active order before leaving player mode');
      }
    }

    const patch: Partial<typeof users.$inferInsert> = { isPlayer: dto.enabled, updatedAt: this.clock.now() };

    if (dto.enabled) {
      if (!user.isActive) throw AppError.forbidden(ErrorCode.userNotActive, 'This account is locked');

      const [skill] = await this.db
        .select({ id: userSkills.id })
        .from(userSkills)
        .where(eq(userSkills.userId, id))
        .limit(1);

      if (!skill) {
        throw AppError.unprocessable(
          ErrorCode.playerModeRequirements,
          'Add at least one game skill before enabling player mode',
        );
      }
    }

    const price = dto.pricePerHour ?? user.pricePerHour;
    if (price < MIN_PRICE_PER_HOUR || price > MAX_PRICE_PER_HOUR) {
      throw AppError.badRequest(
        ErrorCode.playerModeRequirements,
        `pricePerHour must be between ${MIN_PRICE_PER_HOUR} and ${MAX_PRICE_PER_HOUR} VND`,
      );
    }

    if (dto.pricePerHour !== undefined) patch.pricePerHour = dto.pricePerHour;
    if (dto.maxHoursPerHire !== undefined) patch.maxHoursPerHire = dto.maxHoursPerHire;

    const [updated] = await this.db.update(users).set(patch).where(eq(users.id, id)).returning();
    return toUserSummary(updated, { includeEmail: true });
  }

  async searchPlayers(query: SearchPlayersQuery): Promise<Paginated<UserSummary>> {
    const conditions: SQL[] = [eq(users.isActive, true), eq(users.isPlayer, true)];

    if (query.q) {
      const pattern = `%${query.q}%`;
      conditions.push(or(ilike(users.name, pattern), ilike(users.city, pattern))!);
    }
    if (query.city) conditions.push(ilike(users.city, `%${query.city}%`));
    if (query.genders?.length) conditions.push(inArray(users.gender, query.genders));
    if (query.initial) {
      conditions.push(sql`lower(${users.name}) like ${`${query.initial.toLowerCase()}%`}`);
    }
    if (query.status) conditions.push(eq(users.status, query.status));
    if (query.minPrice !== undefined) conditions.push(gte(users.pricePerHour, query.minPrice));
    if (query.maxPrice !== undefined) conditions.push(lte(users.pricePerHour, query.maxPrice));
    if (query.minRating !== undefined) {
      conditions.push(
        sql`${users.ratingCount} > 0 and (${users.ratingSum}::numeric / ${users.ratingCount}) >= ${query.minRating}`,
      );
    }
    if (query.gameId) {
      conditions.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(userSkills)
            .where(and(eq(userSkills.userId, users.id), eq(userSkills.gameId, query.gameId))),
        ),
      );
    }
    if (query.gameTypeId) {
      conditions.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(userSkills)
            .innerJoin(gameTypeLinks, eq(gameTypeLinks.gameId, userSkills.gameId))
            .where(and(eq(userSkills.userId, users.id), eq(gameTypeLinks.gameTypeId, query.gameTypeId))),
        ),
      );
    }
    if (query.hobbyId) {
      conditions.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(userHobbies)
            .where(and(eq(userHobbies.userId, users.id), eq(userHobbies.gameId, query.hobbyId))),
        ),
      );
    }

    const where = and(...conditions);
    const orderBy = this.playerOrderBy(query.sort);

    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(users)
        .where(where)
        .orderBy(...orderBy)
        .limit(query.pageSize)
        .offset(offsetOf(query.page, query.pageSize)),
      this.db.select({ value: count() }).from(users).where(where),
    ]);

    return paginated(
      rows.map((row) => toUserSummary(row)),
      total?.value ?? 0,
      query.page,
      query.pageSize,
    );
  }

  private playerOrderBy(sort: SearchPlayersQuery['sort']): SQL[] {
    switch (sort) {
      case 'price_asc':
        return [asc(users.pricePerHour), asc(users.name)];
      case 'price_desc':
        return [desc(users.pricePerHour), asc(users.name)];
      case 'rating':
        return [
          desc(sql`coalesce(${users.ratingSum}::numeric / nullif(${users.ratingCount}, 0), 0)`),
          desc(users.ratingCount),
        ];
      case 'newest':
        return [desc(users.createdAt)];
      case 'name':
        return [asc(users.name)];
      case 'ranking':
      default:
        return [desc(users.rankingPoints), desc(users.ratingCount), asc(users.name)];
    }
  }

  async addSkill(userId: string, dto: UpsertSkillDto): Promise<void> {
    const [game] = await this.db.select({ id: games.id }).from(games).where(eq(games.id, dto.gameId)).limit(1);
    if (!game) throw AppError.notFound(ErrorCode.gameNotFound, 'Game not found');

    if (dto.rankId) await this.requireRankOfGame(dto.rankId, dto.gameId);

    const [existing] = await this.db
      .select({ id: userSkills.id })
      .from(userSkills)
      .where(and(eq(userSkills.userId, userId), eq(userSkills.gameId, dto.gameId)))
      .limit(1);

    if (existing) {
      throw AppError.conflict(ErrorCode.conflict, 'This game is already listed as a skill');
    }

    await this.db.insert(userSkills).values({ userId, gameId: dto.gameId, rankId: dto.rankId ?? null });
  }

  async updateSkillRank(userId: string, skillId: string, rankId?: string): Promise<void> {
    const [skill] = await this.db
      .select()
      .from(userSkills)
      .where(and(eq(userSkills.id, skillId), eq(userSkills.userId, userId)))
      .limit(1);

    if (!skill) throw AppError.notFound(ErrorCode.skillNotFound, 'Skill not found');
    if (rankId) await this.requireRankOfGame(rankId, skill.gameId);

    await this.db.update(userSkills).set({ rankId: rankId ?? null }).where(eq(userSkills.id, skillId));
  }

  async removeSkill(userId: string, skillId: string): Promise<void> {
    const deleted = await this.db
      .delete(userSkills)
      .where(and(eq(userSkills.id, skillId), eq(userSkills.userId, userId)))
      .returning({ id: userSkills.id });

    if (deleted.length === 0) throw AppError.notFound(ErrorCode.skillNotFound, 'Skill not found');
  }

  private async requireRankOfGame(rankId: string, gameId: string): Promise<void> {
    const [rank] = await this.db
      .select({ id: gameRanks.id })
      .from(gameRanks)
      .where(and(eq(gameRanks.id, rankId), eq(gameRanks.gameId, gameId)))
      .limit(1);
    if (!rank) throw AppError.badRequest(ErrorCode.rankNotFound, 'Rank does not belong to this game');
  }

  async addHobby(userId: string, dto: AddHobbyDto): Promise<void> {
    const [game] = await this.db.select({ id: games.id }).from(games).where(eq(games.id, dto.gameId)).limit(1);
    if (!game) throw AppError.notFound(ErrorCode.gameNotFound, 'Game not found');

    await this.db
      .insert(userHobbies)
      .values({ userId, gameId: dto.gameId })
      .onConflictDoNothing();
  }

  async removeHobby(userId: string, gameId: string): Promise<void> {
    await this.db
      .delete(userHobbies)
      .where(and(eq(userHobbies.userId, userId), eq(userHobbies.gameId, gameId)));
  }

  async listFavorites(userId: string): Promise<FavoriteGameItemDto[]> {
    const rows = await this.db
      .select({
        id: games.id,
        name: games.name,
        displayName: games.displayName,
        favoritedAt: userFavorites.createdAt,
      })
      .from(userFavorites)
      .innerJoin(games, eq(games.id, userFavorites.gameId))
      .where(eq(userFavorites.userId, userId))
      .orderBy(desc(userFavorites.createdAt));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      displayName: row.displayName,
      favoritedAt: row.favoritedAt.toISOString(),
    }));
  }

  async addFavorite(userId: string, dto: AddFavoriteDto): Promise<void> {
    const [game] = await this.db.select({ id: games.id }).from(games).where(eq(games.id, dto.gameId)).limit(1);
    if (!game) throw AppError.notFound(ErrorCode.gameNotFound, 'Game not found');

    await this.db
      .insert(userFavorites)
      .values({ userId, gameId: dto.gameId })
      .onConflictDoNothing();
  }

  async removeFavorite(userId: string, gameId: string): Promise<void> {
    await this.db
      .delete(userFavorites)
      .where(and(eq(userFavorites.userId, userId), eq(userFavorites.gameId, gameId)));
  }

  async addImage(userId: string, dto: AddImageDto): Promise<{ id: string; url: string }> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(userImages)
      .where(eq(userImages.userId, userId));

    if (value >= MAX_IMAGES) {
      throw AppError.conflict(ErrorCode.conflict, `At most ${MAX_IMAGES} gallery images are allowed`);
    }

    const [row] = await this.db.insert(userImages).values({ userId, url: dto.url }).returning();
    return { id: row.id, url: row.url };
  }

  async removeImage(userId: string, imageId: string): Promise<void> {
    const deleted = await this.db
      .delete(userImages)
      .where(and(eq(userImages.id, imageId), eq(userImages.userId, userId)))
      .returning({ id: userImages.id });
    if (deleted.length === 0) throw AppError.notFound(ErrorCode.notFound, 'Image not found');
  }

  async createAvailability(userId: string, dto: CreateAvailabilityDto): Promise<void> {
    await this.assertAvailabilitySlot(userId, dto);

    await this.db.insert(availabilityWindows).values({
      userId,
      dayOfWeek: dto.dayOfWeek,
      startMinute: dto.startMinute,
      endMinute: dto.endMinute,
    });
  }

  async updateAvailability(
    userId: string,
    windowId: string,
    dto: UpdateAvailabilityDto,
  ): Promise<{ id: string; dayOfWeek: number; startMinute: number; endMinute: number }> {
    const [existing] = await this.db
      .select()
      .from(availabilityWindows)
      .where(and(eq(availabilityWindows.id, windowId), eq(availabilityWindows.userId, userId)))
      .limit(1);

    if (!existing) {
      throw AppError.notFound(ErrorCode.availabilityNotFound, 'Availability window not found');
    }

    const next = {
      dayOfWeek: dto.dayOfWeek ?? existing.dayOfWeek,
      startMinute: dto.startMinute ?? existing.startMinute,
      endMinute: dto.endMinute ?? existing.endMinute,
    };

    await this.assertAvailabilitySlot(userId, next, windowId);

    await this.db
      .update(availabilityWindows)
      .set(next)
      .where(and(eq(availabilityWindows.id, windowId), eq(availabilityWindows.userId, userId)));

    return { id: windowId, ...next };
  }

  private async assertAvailabilitySlot(
    userId: string,
    slot: { dayOfWeek: number; startMinute: number; endMinute: number },
    excludeWindowId?: string,
  ): Promise<void> {
    if (slot.startMinute >= slot.endMinute) {
      throw AppError.badRequest(ErrorCode.validationFailed, 'startMinute must be before endMinute');
    }

    const overlapping = await this.db
      .select({ id: availabilityWindows.id })
      .from(availabilityWindows)
      .where(
        and(
          eq(availabilityWindows.userId, userId),
          eq(availabilityWindows.dayOfWeek, slot.dayOfWeek),
          lt(availabilityWindows.startMinute, slot.endMinute),
          gt(availabilityWindows.endMinute, slot.startMinute),
          excludeWindowId ? ne(availabilityWindows.id, excludeWindowId) : undefined,
        ),
      )
      .limit(1);

    if (overlapping.length > 0) {
      throw AppError.conflict(ErrorCode.availabilityOverlap, 'This window overlaps an existing availability window');
    }
  }

  async removeAvailability(userId: string, windowId: string): Promise<void> {
    const deleted = await this.db
      .delete(availabilityWindows)
      .where(and(eq(availabilityWindows.id, windowId), eq(availabilityWindows.userId, userId)))
      .returning({ id: availabilityWindows.id });

    if (deleted.length === 0) {
      throw AppError.notFound(ErrorCode.availabilityNotFound, 'Availability window not found');
    }
  }

  async isAvailableNow(userId: string): Promise<boolean> {
    const windows = await this.db
      .select({
        dayOfWeek: availabilityWindows.dayOfWeek,
        startMinute: availabilityWindows.startMinute,
        endMinute: availabilityWindows.endMinute,
      })
      .from(availabilityWindows)
      .where(eq(availabilityWindows.userId, userId));

    if (windows.length === 0) return true;
    return isWithinAvailability(this.clock.now(), windows, this.timeZone);
  }

  async listBlocks(userId: string): Promise<Array<{ id: string; user: UserSummary; expiresAt: string | null }>> {
    const now = this.clock.now();
    const rows = await this.db
      .select({ block: userBlocks, blocked: users })
      .from(userBlocks)
      .innerJoin(users, eq(users.id, userBlocks.blockedUserId))
      .where(and(eq(userBlocks.userId, userId), or(isNull(userBlocks.expiresAt), gt(userBlocks.expiresAt, now))))
      .orderBy(desc(userBlocks.createdAt));

    return rows.map((row) => ({
      id: row.block.id,
      user: toUserSummary(row.blocked),
      expiresAt: row.block.expiresAt?.toISOString() ?? null,
    }));
  }

  async block(userId: string, dto: BlockUserDto): Promise<void> {
    if (userId === dto.blockedUserId) {
      throw AppError.badRequest(ErrorCode.cannotMessageSelf, 'You cannot block yourself');
    }
    await this.requireById(dto.blockedUserId);

    const expiresAt = dto.hours ? addHours(this.clock.now(), dto.hours) : null;

    await this.db
      .insert(userBlocks)
      .values({ userId, blockedUserId: dto.blockedUserId, expiresAt })
      .onConflictDoUpdate({
        target: [userBlocks.userId, userBlocks.blockedUserId],
        set: { expiresAt },
      });
  }

  async unblock(userId: string, blockedUserId: string): Promise<void> {
    const deleted = await this.db
      .delete(userBlocks)
      .where(and(eq(userBlocks.userId, userId), eq(userBlocks.blockedUserId, blockedUserId)))
      .returning({ id: userBlocks.id });
    if (deleted.length === 0) throw AppError.notFound(ErrorCode.blockNotFound, 'Block not found');
  }

  async isBlocked(userId: string, otherUserId: string, now: Date): Promise<boolean> {
    const [row] = await this.db
      .select({ id: userBlocks.id })
      .from(userBlocks)
      .where(
        and(
          eq(userBlocks.userId, userId),
          eq(userBlocks.blockedUserId, otherUserId),
          or(isNull(userBlocks.expiresAt), gt(userBlocks.expiresAt, now)),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async isBlockedEitherWay(userA: string, userB: string): Promise<boolean> {
    const now = this.clock.now();
    const [row] = await this.db
      .select({ id: userBlocks.id })
      .from(userBlocks)
      .where(
        and(
          or(
            and(eq(userBlocks.userId, userA), eq(userBlocks.blockedUserId, userB)),
            and(eq(userBlocks.userId, userB), eq(userBlocks.blockedUserId, userA)),
          ),
          or(isNull(userBlocks.expiresAt), gt(userBlocks.expiresAt, now)),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  /** Used by the admin module to page through every account. */
  async adminList(input: {
    page: number;
    pageSize: number;
    role?: 'USER' | 'ADMIN' | 'CHARITY';
    isActive?: boolean;
    isPlayer?: boolean;
    status?: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTAIN';
    q?: string;
  }): Promise<Paginated<UserSummary>> {
    const conditions: SQL[] = [];
    if (input.role) conditions.push(eq(users.role, input.role));
    if (input.isActive !== undefined) conditions.push(eq(users.isActive, input.isActive));
    if (input.isPlayer !== undefined) conditions.push(eq(users.isPlayer, input.isPlayer));
    if (input.status) conditions.push(eq(users.status, input.status));
    if (input.q) {
      const pattern = `%${input.q}%`;
      conditions.push(or(ilike(users.name, pattern), ilike(users.email, pattern))!);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(input.pageSize)
        .offset(offsetOf(input.page, input.pageSize)),
      this.db.select({ value: count() }).from(users).where(where),
    ]);

    return paginated(
      rows.map((row) => toUserSummary(row, { includeEmail: true })),
      total?.value ?? 0,
      input.page,
      input.pageSize,
    );
  }
}
