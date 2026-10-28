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
import { PageMetaDto } from '../../common/openapi/paginated.dto';
import { PageQueryDto } from '../../common/pagination/pagination';
import { UserSummary } from '../users/users.dto';

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

export class OrderGameRefView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  displayName: string | null;
}

export class OrderView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ORDER_STATUSES })
  status: (typeof ORDER_STATUSES)[number];

  @ApiProperty()
  hours: number;

  @ApiProperty({ description: 'VND per hour' })
  hourlyRate: number;

  @ApiProperty({ description: 'VND' })
  totalPrice: number;

  @ApiProperty({ description: 'Platform fee in basis points' })
  feeBps: number;

  @ApiProperty({ description: 'VND paid to the player after the platform fee', nullable: true })
  playerPayout: number | null;

  @ApiProperty()
  message: string;

  @ApiProperty({ nullable: true })
  reason: string | null;

  @ApiProperty({ format: 'date-time' })
  respondBy: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  startsAt: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  scheduledEndAt: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  endedAt: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  @ApiProperty({ type: UserSummary })
  hirer: UserSummary;

  @ApiProperty({ type: UserSummary })
  player: UserSummary;

  @ApiProperty({ type: [OrderGameRefView] })
  games: OrderGameRefView[];

  @ApiProperty()
  canRate: boolean;

  @ApiProperty()
  hasRated: boolean;

  @ApiProperty({ enum: ['NONE', 'HELD', 'SETTLED', 'REFUNDED', 'PARTIALLY_SETTLED'] })
  escrowStatus: 'NONE' | 'HELD' | 'SETTLED' | 'REFUNDED' | 'PARTIALLY_SETTLED';
}

export class OrderPage {
  @ApiProperty({ type: [OrderView] })
  items: OrderView[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class OrderHistoryItemView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ORDER_STATUSES, nullable: true })
  fromStatus: (typeof ORDER_STATUSES)[number] | null;

  @ApiProperty({ enum: ORDER_STATUSES })
  toStatus: (typeof ORDER_STATUSES)[number];

  @ApiProperty({ nullable: true })
  reason: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  actorId: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}
