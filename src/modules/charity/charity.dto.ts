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
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MIN_DONATION, MIN_WITHDRAWAL } from '../../common/money/money';
import { PageMetaDto } from '../../common/openapi/paginated.dto';
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

export class CharityStats {
  @ApiProperty({ description: 'Total amount donated, in VND' })
  raised: number;

  @ApiProperty()
  donations: number;

  @ApiProperty()
  donors: number;
}

export class CharityAccountRef {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'email' })
  email: string;
}

export class CharityView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  organizationName: string;

  @ApiProperty({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ nullable: true })
  information: string | null;

  @ApiProperty({ nullable: true })
  address: string | null;

  @ApiProperty({ nullable: true, format: 'email', description: 'Contact email' })
  email: string | null;

  @ApiProperty({ nullable: true })
  phone: string | null;

  @ApiProperty({ description: 'Available balance, in VND' })
  balance: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  @ApiProperty({ type: CharityStats })
  stats: CharityStats;

  @ApiProperty({ type: CharityAccountRef, nullable: true })
  account: CharityAccountRef | null;
}

export class DonationDonor {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  avatarUrl: string | null;
}

export class DonationView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  charityId: string;

  @ApiProperty({ nullable: true })
  charityName: string | null;

  @ApiProperty({ description: 'Amount in VND' })
  amount: number;

  @ApiProperty({ nullable: true })
  message: string | null;

  @ApiProperty({ type: DonationDonor, nullable: true })
  donor: DonationDonor | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class DonationResultView {
  @ApiProperty({ format: 'uuid' })
  donationId: string;

  @ApiProperty({ format: 'uuid' })
  charityId: string;

  @ApiProperty({ description: 'Amount in VND' })
  amount: number;
}

export class CharityWithdrawalView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  charityId: string;

  @ApiProperty({ nullable: true })
  charityName: string | null;

  @ApiProperty({ description: 'Amount in VND' })
  amount: number;

  @ApiProperty({ enum: WITHDRAWAL_STATUSES })
  status: (typeof WITHDRAWAL_STATUSES)[number];

  @ApiProperty({ nullable: true })
  note: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  processedAt: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class CharityPage {
  @ApiProperty({ type: [CharityView] })
  items: CharityView[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class CharityWithdrawalPage {
  @ApiProperty({ type: [CharityWithdrawalView] })
  items: CharityWithdrawalView[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class DonationPage {
  @ApiProperty({ type: [DonationView] })
  items: DonationView[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}
