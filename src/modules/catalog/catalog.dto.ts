import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageMetaDto } from '../../common/openapi/paginated.dto';
import { PageQueryDto } from '../../common/pagination/pagination';

export class ListGamesQuery extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Matches name, display name or aliases' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  gameTypeId?: string;
}

export class MostFavoritesQuery {
  @ApiPropertyOptional({ default: 8, minimum: 1, maximum: 20 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit: number = 8;
}

export class FavoriteGameDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  displayName: string | null;

  @ApiProperty({ description: 'How many players marked this game as a favorite' })
  favoriteCount: number;
}

export class ListGameTypesQuery extends PageQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class CreateGameDto {  @ApiProperty({ example: 'League of Legends' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'LOL' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({ example: 'Lien Minh Huyen Thoai, LoL' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  otherNames?: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  gameTypeIds?: string[];
}

export class UpdateGameDto extends PartialType(CreateGameDto) {}

export class CreateGameTypeDto {
  @ApiProperty({ example: 'MOBA' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'MOBA' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  shortName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpdateGameTypeDto extends PartialType(CreateGameTypeDto) {}

export class CreateRankDto {
  @ApiProperty({ example: 1, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  no: number;

  @ApiProperty({ example: 'Bronze' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;
}

export class UpdateRankDto extends PartialType(CreateRankDto) {}

export class GameTypeRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  shortName: string | null;
}

export class GameRowDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  displayName: string | null;

  @ApiProperty({ nullable: true, description: 'Comma separated aliases' })
  otherNames: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export class GameView extends GameRowDto {
  @ApiProperty({ type: [GameTypeRefDto] })
  types: GameTypeRefDto[];
}

export class GameRankDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  no: number;

  @ApiProperty()
  name: string;
}

export class GameRankRowDto extends GameRankDto {
  @ApiProperty({ format: 'uuid' })
  gameId: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

export class GameDetail extends GameView {
  @ApiProperty({ type: [GameRankDto] })
  ranks: GameRankDto[];
}

export class GameTypeRowDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  shortName: string | null;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export class GameTypeView extends GameTypeRowDto {
  @ApiProperty()
  gameCount: number;
}

export class GameTypeDetail extends GameTypeView {
  @ApiProperty({ type: [GameRowDto] })
  games: GameRowDto[];
}

export class GamePage {
  @ApiProperty({ type: [GameView] })
  items: GameView[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class GameTypePage {
  @ApiProperty({ type: [GameTypeView] })
  items: GameTypeView[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}
