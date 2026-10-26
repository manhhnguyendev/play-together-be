import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_HOURS_PER_HIRE, MIN_HOURS_PER_HIRE } from '../../common/money/money';
import { PageQueryDto } from '../../common/pagination/pagination';

export const ORDER_STATUSES = [
  'PROCESSING',
  'ACCEPTED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
  'ENDED_EARLY_BY_HIRER',
  'ENDED_EARLY_BY_PLAYER',
  'INTERRUPTED',
] as const;

export class CreateOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  playerId: string;

  @ApiProperty({ example: 2, minimum: MIN_HOURS_PER_HIRE, maximum: MAX_HOURS_PER_HIRE })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_HOURS_PER_HIRE)
  @Max(MAX_HOURS_PER_HIRE)
  hours: number;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  message: string;

  @ApiProperty({ type: [String], format: 'uuid', description: 'Games the player must be skilled at' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  gameIds: string[];
}

export class RejectOrderDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class EndEarlyDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListOrdersQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: ORDER_STATUSES })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: (typeof ORDER_STATUSES)[number];
}
