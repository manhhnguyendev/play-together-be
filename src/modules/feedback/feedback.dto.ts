import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PageQueryDto } from '../../common/pagination/pagination';

export const FEEDBACK_TYPES = ['BUG', 'FEATURE', 'COMPLAINT', 'OTHER'] as const;
export const MY_FEEDBACK_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export class CreateFeedbackDto {
  @ApiProperty({ minLength: 3, maxLength: 200 })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @ApiProperty({ minLength: 5, maxLength: 2000 })
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  message: string;

  @ApiPropertyOptional({ enum: FEEDBACK_TYPES, default: 'OTHER' })
  @IsOptional()
  @IsIn(FEEDBACK_TYPES)
  type: (typeof FEEDBACK_TYPES)[number] = 'OTHER';
}

export class ListMyFeedbackQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: MY_FEEDBACK_STATUSES })
  @IsOptional()
  @IsIn(MY_FEEDBACK_STATUSES)
  status?: (typeof MY_FEEDBACK_STATUSES)[number];
}

export type MyFeedbackView = {
  id: string;
  title: string;
  message: string;
  type: (typeof FEEDBACK_TYPES)[number];
  status: (typeof MY_FEEDBACK_STATUSES)[number];
  adminNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
};
