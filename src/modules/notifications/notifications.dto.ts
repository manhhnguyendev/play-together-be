import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { PageMetaDto } from '../../common/openapi/paginated.dto';
import { PageQueryDto } from '../../common/pagination/pagination';

export class ListNotificationsQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['UNREAD', 'READ'] })
  @IsOptional()
  @IsIn(['UNREAD', 'READ'])
  status?: 'UNREAD' | 'READ';
}

export class BroadcastNotificationDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  body: string;

  @ApiPropertyOptional({ example: 'https://app.playtogether.local/orders' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  referenceUrl?: string;
}

export class NotificationDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty({ nullable: true })
  referenceUrl: string | null;

  @ApiProperty({ enum: ['UNREAD', 'READ'] })
  status: 'UNREAD' | 'READ';

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  readAt: string | null;
}

export class NotificationPage {
  @ApiProperty({ type: [NotificationDto] })
  items: NotificationDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class NotificationUpdatedCountDto {
  @ApiProperty()
  updated: number;
}

export class NotificationDeletedCountDto {
  @ApiProperty()
  deleted: number;
}
