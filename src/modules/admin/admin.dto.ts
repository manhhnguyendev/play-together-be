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
import { PageQueryDto } from '../../common/pagination/pagination';

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

export type AdminFeedbackView = {
  id: string;
  userId: string;
  author: { id: string; name: string; email: string } | null;
  title: string;
  message: string;
  type: 'BUG' | 'FEATURE' | 'COMPLAINT' | 'OTHER';
  status: (typeof FEEDBACK_STATUSES)[number];
  adminNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type PlatformOverview = {
  users: { total: number; active: number; players: number; charities: number; admins: number };
  orders: { total: number; byStatus: Record<string, number>; active: number; completed: number };
  money: {
    platformFees: number;
    escrowHeld: number;
    donations: number;
    pendingUserWithdrawals: number;
    pendingCharityWithdrawals: number;
  };
  moderation: {
    pendingReports: number;
    pendingFeedback: number;
    flaggedRatings: number;
  };
};
