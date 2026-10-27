import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { MAX_DEPOSIT, MIN_DEPOSIT, MIN_WITHDRAWAL } from '../../common/money/money';
import { PageMetaDto } from '../../common/openapi/paginated.dto';
import { PageQueryDto } from '../../common/pagination/pagination';

export const LEDGER_TYPES = [
  'DEPOSIT',
  'WITHDRAWAL',
  'ESCROW_HOLD',
  'ESCROW_RELEASE',
  'ESCROW_REFUND',
  'ORDER_EARNING',
  'PLATFORM_FEE',
  'DONATION',
  'REPORT_REFUND',
  'MAINTENANCE_REFUND',
  'CHARITY_WITHDRAWAL',
  'ADJUSTMENT',
] as const;

export class CreateDepositDto {
  @ApiProperty({ example: 100_000, minimum: MIN_DEPOSIT, maximum: MAX_DEPOSIT })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_DEPOSIT)
  @Max(MAX_DEPOSIT)
  amount: number;
}

export class RequestWithdrawalDto {
  @ApiProperty({ example: 50_000, minimum: MIN_WITHDRAWAL })
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

export class ListTransactionsQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: LEDGER_TYPES })
  @IsOptional()
  @IsIn(LEDGER_TYPES)
  type?: (typeof LEDGER_TYPES)[number];
}

export class ListWithdrawalsQuery extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'PAID', 'REJECTED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['PENDING', 'PAID', 'REJECTED', 'CANCELLED'])
  status?: 'PENDING' | 'PAID' | 'REJECTED' | 'CANCELLED';
}

export class ResolveWithdrawalDto {
  @ApiProperty({ enum: ['PAID', 'REJECTED'] })
  @IsIn(['PAID', 'REJECTED'])
  status: 'PAID' | 'REJECTED';

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

export class MomoIpnDto {
  @ApiProperty({ description: 'The deposit id that was sent to MoMo as orderId' })
  @IsUUID()
  orderId: string;

  @ApiProperty({ example: 0, description: '0 means the payment succeeded' })
  @Type(() => Number)
  @IsInt()
  resultCode: number;

  @ApiProperty({ example: 100_000 })
  @Type(() => Number)
  @IsNumber()
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  requestId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  transId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  extraData?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  orderInfo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  orderType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  payType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  responseTime?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  partnerCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  signature?: string;
}

export type WalletSummary = {
  walletId: string;
  availableBalance: number;
  pendingBalance: number;
  pendingCredits: Array<{ id: string; orderId: string; amount: number; availableAt: string }>;
};

export class WithdrawalUserRef {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ format: 'email' })
  email: string;
}

export class WithdrawalView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Amount in VND' })
  amount: number;

  @ApiProperty({ enum: ['PENDING', 'PAID', 'REJECTED', 'CANCELLED'] })
  status: 'PENDING' | 'PAID' | 'REJECTED' | 'CANCELLED';

  @ApiProperty({ nullable: true })
  note: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  processedAt: string | null;

  @ApiProperty({ type: WithdrawalUserRef })
  user: WithdrawalUserRef;
}

export class MyWithdrawalView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Amount in VND' })
  amount: number;

  @ApiProperty({ enum: ['PENDING', 'PAID', 'REJECTED', 'CANCELLED'] })
  status: 'PENDING' | 'PAID' | 'REJECTED' | 'CANCELLED';

  @ApiProperty()
  provider: string;

  @ApiProperty({ nullable: true })
  note: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  processedAt: string | null;
}

export class WithdrawalResolutionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ['PENDING', 'PAID', 'REJECTED', 'CANCELLED'] })
  status: 'PENDING' | 'PAID' | 'REJECTED' | 'CANCELLED';
}

export class WithdrawalPage {
  @ApiProperty({ type: [WithdrawalView] })
  items: WithdrawalView[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}
