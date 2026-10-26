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
