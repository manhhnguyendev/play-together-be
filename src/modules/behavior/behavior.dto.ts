import { ApiProperty } from '@nestjs/swagger';
import { PageMetaDto } from '../../common/openapi/paginated.dto';

export const BEHAVIOR_EVENTS = [
  'RATING_RECEIVED',
  'RATING_REVOKED',
  'ORDER_REJECTED',
  'ORDER_EXPIRED',
  'ORDER_EARLY_END',
  'REPORT_APPROVED',
  'MANUAL_ADJUSTMENT',
] as const;

export class BehaviorHistoryItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: BEHAVIOR_EVENTS })
  event: (typeof BEHAVIOR_EVENTS)[number];

  @ApiProperty({ enum: ['ADD', 'SUB'] })
  operation: 'ADD' | 'SUB';

  @ApiProperty({ enum: ['POINTS', 'SATISFACTION'] })
  pointType: 'POINTS' | 'SATISFACTION';

  @ApiProperty({ description: 'Absolute amount applied to the counter', minimum: 1 })
  amount: number;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Rating, order, report or adjustment id' })
  referenceId: string | null;

  @ApiProperty({ nullable: true })
  note: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class BehaviorHistoryPage {
  @ApiProperty({ type: [BehaviorHistoryItemDto] })
  items: BehaviorHistoryItemDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}
