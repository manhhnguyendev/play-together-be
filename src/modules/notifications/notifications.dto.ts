import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
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
  id: string;
  title: string;
  body: string;
  referenceUrl: string | null;
  status: 'UNREAD' | 'READ';
  createdAt: string;
  readAt: string | null;
}
