import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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

export const PLAYER_SORTS = ['ranking', 'rating', 'price_asc', 'price_desc', 'newest'] as const;

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

export type UserSummary = {
  id: string;
  name: string;
  email?: string;
  avatarUrl: string | null;
  city: string | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  bio: string | null;
  status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'MAINTAIN';
  isActive: boolean;
  isPlayer: boolean;
  pricePerHour: number;
  maxHoursPerHire: number;
  rating: number;
  ratingCount: number;
  ordersCount: number;
  completedOrdersCount: number;
  totalHours: number;
  rankingPoints: number;
  createdAt: string;
};

export type UserProfile = UserSummary & {
  dateOfBirth: string | null;
  behavior: { points: number; satisfaction: number };
  skills: Array<{
    id: string;
    game: { id: string; name: string; displayName: string | null };
    rank: { id: string; no: number; name: string } | null;
  }>;
  hobbies: Array<{ id: string; name: string; displayName: string | null }>;
  images: Array<{ id: string; url: string; createdAt: string }>;
  availability: Array<{ id: string; dayOfWeek: number; startMinute: number; endMinute: number }>;
  isBlockedByMe: boolean;
  canHire: boolean;
};
