import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { UserSummary } from '../users/users.dto';

export class ListRecommendationsQuery {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export type RecommendationView = {
  user: UserSummary;
  score: number;
  matchedGames: Array<{ id: string; name: string }>;
  reason: string;
};
