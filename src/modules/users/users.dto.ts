import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_HOURS_PER_HIRE, MIN_HOURS_PER_HIRE } from '../../common/money/money';
import { PageMetaDto } from '../../common/openapi/paginated.dto';
import { PageQueryDto } from '../../common/pagination/pagination';

const USER_STATUSES = ['ONLINE', 'OFFLINE', 'BUSY'] as const;
const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;

export class UpdateProfileDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: '2000-05-17' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateOfBirth?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ enum: GENDERS })
  @IsOptional()
  @IsIn(GENDERS)
  gender?: (typeof GENDERS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  avatarUrl?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string;
}

export class UpdateStatusDto {
  @ApiProperty({ enum: USER_STATUSES })
  @IsIn(USER_STATUSES)
  status: (typeof USER_STATUSES)[number];
}

export class PlayerModeDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({ example: 50000, description: 'VND per hour' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10_000)
  @Max(10_000_000)
  pricePerHour?: number;

  @ApiPropertyOptional({ example: 4, minimum: MIN_HOURS_PER_HIRE, maximum: MAX_HOURS_PER_HIRE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_HOURS_PER_HIRE)
  @Max(MAX_HOURS_PER_HIRE)
  maxHoursPerHire?: number;
}

export class UpsertSkillDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  gameId: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  rankId?: string;
}

export class UpdateSkillRankDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  rankId?: string;
}

export class AddHobbyDto {  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  gameId: string;
}

export class AddFavoriteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  gameId: string;
}

export class FavoriteGameItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  displayName: string | null;

  @ApiProperty({ format: 'date-time' })
  favoritedAt: string;
}

export class AddImageDto {
  @ApiProperty({ example: 'https://cdn.playtogether.local/me/1.jpg' })
  @IsUrl({ require_tld: false })
  url: string;
}

export class CreateAvailabilityDto {
  @ApiProperty({ minimum: 1, maximum: 7, description: 'Monday = 1 ... Sunday = 7' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek: number;

  @ApiProperty({ minimum: 0, maximum: 1439, description: 'Minutes from midnight' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1439)
  startMinute: number;

  @ApiProperty({ minimum: 1, maximum: 1440, description: 'Minutes from midnight, exclusive' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  endMinute: number;
}

export class BlockUserDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  blockedUserId: string;

  @ApiPropertyOptional({ description: 'Auto-expire the block after this many hours' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 365)
  hours?: number;
}

export const PLAYER_SORTS = ['ranking', 'rating', 'price_asc', 'price_desc', 'newest', 'name'] as const;

export class SearchPlayersQuery extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Matches name or city' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  gameId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  gameTypeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  hobbyId?: string;

  @ApiPropertyOptional({ enum: GENDERS, isArray: true, description: 'Repeat or comma-separate to allow several' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((entry) => entry.trim().toUpperCase())
          .filter(Boolean)
      : value,
  )
  @IsIn(GENDERS, { each: true })
  genders?: Array<(typeof GENDERS)[number]>;

  @ApiPropertyOptional({ description: 'First letter of the player name', example: 'A' })
  @IsOptional()
  @Matches(/^[A-Za-z]$/)
  initial?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ enum: ['ONLINE', 'OFFLINE'] })
  @IsOptional()
  @IsIn(['ONLINE', 'OFFLINE'])
  status?: 'ONLINE' | 'OFFLINE';

  @ApiPropertyOptional({ example: 20000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 200000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ example: 4.5 })
  @IsOptional()
  @Type(() => Number)
  minRating?: number;

  @ApiPropertyOptional({ enum: PLAYER_SORTS, default: 'ranking' })
  @IsOptional()
  @IsIn(PLAYER_SORTS)
  sort?: (typeof PLAYER_SORTS)[number] = 'ranking';
}

export class UserSummary {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ description: 'Only exposed to the account owner and administrators' })
  email?: string;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl: string | null;

  @ApiPropertyOptional({ nullable: true })
  city: string | null;

  @ApiProperty({ enum: GENDERS })
  gender: 'MALE' | 'FEMALE' | 'OTHER';

  @ApiPropertyOptional({ nullable: true })
  bio: string | null;

  @ApiProperty({ enum: ['ONLINE', 'OFFLINE', 'BUSY', 'MAINTAIN'] })
  status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTAIN';

  @ApiProperty({ enum: ['USER', 'ADMIN', 'CHARITY'] })
  role: 'USER' | 'ADMIN' | 'CHARITY';

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  isPlayer: boolean;

  @ApiProperty({ description: 'VND per hour' })
  pricePerHour: number;

  @ApiProperty()
  maxHoursPerHire: number;

  @ApiProperty()
  rating: number;

  @ApiProperty()
  ratingCount: number;

  @ApiProperty()
  ordersCount: number;

  @ApiProperty()
  completedOrdersCount: number;

  @ApiProperty({ description: 'Completed orders that ended within the scheduled window' })
  onTimeCount: number;

  @ApiProperty()
  totalHours: number;

  @ApiProperty()
  rankingPoints: number;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class BehaviorView {
  @ApiProperty({ minimum: 0, maximum: 100 })
  points: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  satisfaction: number;
}

export class AvailabilityWindowView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ minimum: 1, maximum: 7, description: 'Monday = 1 ... Sunday = 7' })
  dayOfWeek: number;

  @ApiProperty({ description: 'Minutes from midnight' })
  startMinute: number;

  @ApiProperty({ description: 'Minutes from midnight, exclusive' })
  endMinute: number;
}

export class UserImageView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  url: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class BlockedUserView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: UserSummary })
  user: UserSummary;

  @ApiProperty({ format: 'date-time', nullable: true })
  expiresAt: string | null;
}

export class SkillGameRefView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  displayName: string | null;
}

export class SkillRankRefView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  no: number;

  @ApiProperty()
  name: string;
}

export class UserSkillView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: SkillGameRefView })
  game: SkillGameRefView;

  @ApiProperty({ type: SkillRankRefView, nullable: true })
  rank: SkillRankRefView | null;
}

export class UserHobbyView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  displayName: string | null;
}

export class UserProfileView extends UserSummary {
  @ApiProperty({ nullable: true, description: 'Only exposed to the account owner' })
  dateOfBirth: string | null;

  @ApiProperty({ type: BehaviorView })
  behavior: BehaviorView;

  @ApiProperty({ type: [UserSkillView] })
  skills: UserSkillView[];

  @ApiProperty({ type: [UserHobbyView] })
  hobbies: UserHobbyView[];

  @ApiProperty({ type: [UserImageView] })
  images: UserImageView[];

  @ApiProperty({ type: [AvailabilityWindowView] })
  availability: AvailabilityWindowView[];

  @ApiProperty()
  isBlockedByMe: boolean;

  @ApiProperty()
  canHire: boolean;
}

export type UserProfile = UserProfileView;

export class UserPage {
  @ApiProperty({ type: [UserSummary] })
  items: UserSummary[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}
