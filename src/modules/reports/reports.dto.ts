import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PageQueryDto } from '../../common/pagination/pagination';

export const REPORT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const REPORT_SCOPES = ['submitted', 'received'] as const;
export const REPORT_DECISIONS = ['APPROVED', 'REJECTED'] as const;

export class CreateReportDto {
  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  message: string;
}

export class ListReportsQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: REPORT_SCOPES, default: 'submitted' })
  @IsOptional()
  @IsIn(REPORT_SCOPES)
  scope: (typeof REPORT_SCOPES)[number] = 'submitted';

  @ApiPropertyOptional({ enum: REPORT_STATUSES })
  @IsOptional()
  @IsIn(REPORT_STATUSES)
  status?: (typeof REPORT_STATUSES)[number];
}

export class ListAdminReportsQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: REPORT_STATUSES })
  @IsOptional()
  @IsIn(REPORT_STATUSES)
  status?: (typeof REPORT_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Search in the report message' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class ResolveReportDto {
  @ApiProperty({ enum: REPORT_DECISIONS })
  @IsIn(REPORT_DECISIONS)
  decision: (typeof REPORT_DECISIONS)[number];

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, description: 'Behavior points to deduct from the target' })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  points?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, description: 'Satisfaction points to deduct from the target' })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  satisfaction?: number;

  @ApiPropertyOptional({ description: 'Lock the target account and revoke its sessions' })
  @IsOptional()
  @IsBoolean()
  disableAccount?: boolean;

  @ApiPropertyOptional({ minimum: 0, description: 'Amount clawed back from the player and refunded to the hirer' })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  refundAmount?: number;
}

export type ReportParty = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type ReportDto = {
  id: string;
  orderId: string;
  reporter: ReportParty | null;
  target: ReportParty | null;
  message: string;
  status: (typeof REPORT_STATUSES)[number];
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
};
