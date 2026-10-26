import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PageQueryDto } from '../../common/pagination/pagination';

export const RATING_SORTS = ['newest', 'highest', 'lowest'] as const;
export const VIOLATION_DECISIONS = ['UPHELD', 'DISMISSED'] as const;

export class CreateRatingDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rate: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class FlagRatingDto {
  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class ResolveViolationDto {
  @ApiProperty({ enum: VIOLATION_DECISIONS })
  @IsIn(VIOLATION_DECISIONS)
  decision: (typeof VIOLATION_DECISIONS)[number];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListRatingsQuery extends PageQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rate?: number;

  @ApiPropertyOptional({ enum: RATING_SORTS, default: 'newest' })
  @IsOptional()
  @IsIn(RATING_SORTS)
  sort: (typeof RATING_SORTS)[number] = 'newest';
}

export class ListFlaggedRatingsQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['FLAGGED', 'UPHELD', 'DISMISSED'], default: 'FLAGGED' })
  @IsOptional()
  @IsIn(['FLAGGED', 'UPHELD', 'DISMISSED'])
  status: 'FLAGGED' | 'UPHELD' | 'DISMISSED' = 'FLAGGED';
}

export type RatingAuthor = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type RatingDto = {
  id: string;
  orderId: string;
  raterId: string;
  rateeId: string;
  rate: number;
  comment: string | null;
  isActive: boolean;
  violationStatus: 'NONE' | 'FLAGGED' | 'UPHELD' | 'DISMISSED';
  violationReason: string | null;
  rater: RatingAuthor | null;
  ratee: RatingAuthor | null;
  createdAt: string;
};

export type RatingSummaryDto = {
  userId: string;
  average: number;
  count: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
};
