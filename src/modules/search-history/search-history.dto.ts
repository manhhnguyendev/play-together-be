import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class RecordSearchDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  query: string;
}

export class ListSearchHistoryQuery {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export type SearchHistoryItem = {
  id: string;
  query: string;
  createdAt: string;
};

export class HotSearchQuery {
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 20 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit: number = 10;
}

export class HotSearchItemDto {
  @ApiProperty()
  query: string;

  @ApiProperty({ description: 'How many times the query was recorded in the trending window' })
  searches: number;
}
