import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { UserSummary } from '../users/users.dto';

export class ListRecommendationsQuery {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export class RecommendationGameView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;
}

export class RecommendationView {
  @ApiProperty({ type: UserSummary })
  user: UserSummary;

  @ApiProperty()
  score: number;

  @ApiProperty({ type: [RecommendationGameView] })
  matchedGames: RecommendationGameView[];

  @ApiProperty()
  reason: string;
}
