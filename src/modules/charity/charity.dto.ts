import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MIN_DONATION, MIN_WITHDRAWAL } from '../../common/money/money';
import { PageQueryDto } from '../../common/pagination/pagination';

export const WITHDRAWAL_DECISIONS = ['PAID', 'REJECTED'] as const;
export const WITHDRAWAL_STATUSES = ['PENDING', 'PAID', 'REJECTED', 'CANCELLED'] as const;

export class CreateDonationDto {
  @ApiProperty({ example: 50_000, minimum: MIN_DONATION })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_DONATION)
  amount: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}

export class ListCharitiesQuery extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Search by organization name or description' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class ListDonationsQuery extends PageQueryDto {}

export class ListAdminCharitiesQuery extends ListCharitiesQuery {}

export class CreateCharityWithdrawalDto {
  @ApiProperty({ example: 100_000, minimum: MIN_WITHDRAWAL })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_WITHDRAWAL)
  amount: number;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

export class ResolveCharityWithdrawalDto {
  @ApiProperty({ enum: WITHDRAWAL_DECISIONS })
  @IsIn(WITHDRAWAL_DECISIONS)
  decision: (typeof WITHDRAWAL_DECISIONS)[number];

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

export class CreateCharityAccountDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/[A-Za-z]/, { message: 'password must contain a letter' })
  @Matches(/\d/, { message: 'password must contain a digit' })
  password: string;

  @ApiProperty({ maxLength: 150 })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  organizationName: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  information?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiPropertyOptional({ format: 'email' })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  contactEmail?: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ format: 'uri' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(1000)
  avatarUrl?: string;
}

export class UpdateCharityDto {
  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  organizationName?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  information?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiPropertyOptional({ format: 'email' })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  contactEmail?: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ format: 'uri' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(1000)
  avatarUrl?: string;
}

export class UpdateCharityAsAdminDto extends UpdateCharityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListCharityWithdrawalsQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: WITHDRAWAL_STATUSES })
  @IsOptional()
  @IsIn(WITHDRAWAL_STATUSES)
  status?: (typeof WITHDRAWAL_STATUSES)[number];
}

export type CharityStats = {
  raised: number;
  donations: number;
  donors: number;
};

export type CharityView = {
  id: string;
  userId: string;
  organizationName: string;
  avatarUrl: string | null;
  information: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  balance: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  stats: CharityStats;
  account: { id: string; email: string } | null;
};

export type DonationView = {
  id: string;
  charityId: string;
  charityName: string | null;
  amount: number;
  message: string | null;
  donor: { id: string; name: string; avatarUrl: string | null } | null;
  createdAt: string;
};

export type CharityWithdrawalView = {
  id: string;
  charityId: string;
  charityName: string | null;
  amount: number;
  status: (typeof WITHDRAWAL_STATUSES)[number];
  note: string | null;
  processedAt: string | null;
  createdAt: string;
};
