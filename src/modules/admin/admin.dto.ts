import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageMetaDto } from '../../common/openapi/paginated.dto';
import { PageQueryDto } from '../../common/pagination/pagination';
import { UserSummary } from '../users/users.dto';

export const ADMIN_USER_ROLES = ['USER', 'ADMIN', 'CHARITY'] as const;
export const ADMIN_USER_STATUSES = ['ONLINE', 'OFFLINE', 'BUSY', 'MAINTAIN'] as const;
export const FEEDBACK_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const FEEDBACK_DECISIONS = ['APPROVED', 'REJECTED'] as const;

export class ListAdminUsersQuery extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Search by name or email' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ADMIN_USER_ROLES })
  @IsOptional()
  @IsIn(ADMIN_USER_ROLES)
  role?: (typeof ADMIN_USER_ROLES)[number];

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: 'true' | 'false';

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  isPlayer?: 'true' | 'false';
}

export class AdminUpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPlayer?: boolean;

  @ApiPropertyOptional({ enum: ADMIN_USER_ROLES })
  @IsOptional()
  @IsIn(ADMIN_USER_ROLES)
  role?: (typeof ADMIN_USER_ROLES)[number];

  @ApiPropertyOptional({ enum: ADMIN_USER_STATUSES })
  @IsOptional()
  @IsIn(ADMIN_USER_STATUSES)
  status?: (typeof ADMIN_USER_STATUSES)[number];
}

export class ToggleMaintenanceDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}

export class BroadcastNotificationDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  body: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  referenceUrl?: string;
}

export class ListAdminFeedbackQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: FEEDBACK_STATUSES })
  @IsOptional()
  @IsIn(FEEDBACK_STATUSES)
  status?: (typeof FEEDBACK_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Search by title or message' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class ResolveFeedbackDto {
  @ApiProperty({ enum: FEEDBACK_DECISIONS })
  @IsIn(FEEDBACK_DECISIONS)
  decision: (typeof FEEDBACK_DECISIONS)[number];

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNote?: string;
}

export class AdjustBehaviorDto {
  @ApiProperty({ minimum: -100, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(-100)
  @Max(100)
  points: number;

  @ApiProperty({ minimum: -100, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(-100)
  @Max(100)
  satisfaction: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AdminFeedbackAuthorDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ format: 'email' })
  email: string;
}

export class AdminFeedbackView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ type: AdminFeedbackAuthorDto, nullable: true })
  author: AdminFeedbackAuthorDto | null;

  @ApiProperty()
  title: string;

  @ApiProperty()
  message: string;

  @ApiProperty({ enum: ['BUG', 'FEATURE', 'COMPLAINT', 'OTHER'] })
  type: 'BUG' | 'FEATURE' | 'COMPLAINT' | 'OTHER';

  @ApiProperty({ enum: FEEDBACK_STATUSES })
  status: (typeof FEEDBACK_STATUSES)[number];

  @ApiProperty({ nullable: true })
  adminNote: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  resolvedAt: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

class PlatformUserStats {
  @ApiProperty()
  total: number;

  @ApiProperty()
  active: number;

  @ApiProperty()
  players: number;

  @ApiProperty()
  charities: number;

  @ApiProperty()
  admins: number;
}

class PlatformOrderStats {
  @ApiProperty()
  total: number;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  byStatus: Record<string, number>;

  @ApiProperty()
  active: number;

  @ApiProperty()
  completed: number;
}

class PlatformMoneyStats {
  @ApiProperty()
  platformFees: number;

  @ApiProperty()
  escrowHeld: number;

  @ApiProperty()
  donations: number;

  @ApiProperty()
  pendingUserWithdrawals: number;

  @ApiProperty()
  pendingCharityWithdrawals: number;
}

class PlatformModerationStats {
  @ApiProperty()
  pendingReports: number;

  @ApiProperty()
  pendingFeedback: number;

  @ApiProperty()
  flaggedRatings: number;
}

export class PlatformOverview {
  @ApiProperty({ type: PlatformUserStats })
  users: PlatformUserStats;

  @ApiProperty({ type: PlatformOrderStats })
  orders: PlatformOrderStats;

  @ApiProperty({ type: PlatformMoneyStats })
  money: PlatformMoneyStats;

  @ApiProperty({ type: PlatformModerationStats })
  moderation: PlatformModerationStats;
}

export class BehaviorAdjustmentDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  ratingSum: number;

  @ApiProperty()
  ratingCount: number;

  @ApiProperty()
  ordersCount: number;

  @ApiProperty()
  completedOrdersCount: number;

  @ApiProperty()
  totalHours: number;

  @ApiProperty()
  onTimeCount: number;

  @ApiProperty()
  rankingPoints: number;
}

export class BroadcastResultDto {
  @ApiProperty({ description: 'Number of users who received the notification' })
  recipients: number;
}

export class MaintenanceStateDto {
  @ApiProperty()
  enabled: boolean;
}

export class AdminUsersPage {
  @ApiProperty({ type: [UserSummary] })
  items: UserSummary[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class AdminFeedbackPage {
  @ApiProperty({ type: [AdminFeedbackView] })
  items: AdminFeedbackView[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}
