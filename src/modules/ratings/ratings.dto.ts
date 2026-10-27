import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PageMetaDto } from '../../common/openapi/paginated.dto';
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

export class RatingAuthor {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  avatarUrl: string | null;
}

export class RatingDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  orderId: string;

  @ApiProperty({ format: 'uuid' })
  raterId: string;

  @ApiProperty({ format: 'uuid' })
  rateeId: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  rate: number;

  @ApiProperty({ nullable: true })
  comment: string | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ enum: ['NONE', 'FLAGGED', 'UPHELD', 'DISMISSED'] })
  violationStatus: 'NONE' | 'FLAGGED' | 'UPHELD' | 'DISMISSED';

  @ApiProperty({ nullable: true })
  violationReason: string | null;

  @ApiProperty({ type: RatingAuthor, nullable: true })
  rater: RatingAuthor | null;

  @ApiProperty({ type: RatingAuthor, nullable: true })
  ratee: RatingAuthor | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class RatingSummaryDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  average: number;

  @ApiProperty()
  count: number;

  @ApiProperty({
    type: 'object',
    description: 'Number of ratings per score (1-5)',
    additionalProperties: { type: 'number' },
    example: { '1': 0, '2': 1, '3': 2, '4': 5, '5': 9 },
  })
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

export class RatingPage {
  @ApiProperty({ type: [RatingDto] })
  items: RatingDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}
