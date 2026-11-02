import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PageMetaDto } from '../../common/openapi/paginated.dto';
import { PageQueryDto } from '../../common/pagination/pagination';
import { BehaviorHistoryItemDto } from '../behavior/behavior.dto';
import { UserSummary } from '../users/users.dto';
import {
  depositStatusEnum,
  escrowStatusEnum,
  ledgerAccountEnum,
  ledgerDirectionEnum,
  ledgerTypeEnum,
  orderStatusEnum,
} from '../../db/schema';

type InValues = readonly string[];

const queryEnum = (values: InValues) => ({ enum: values as unknown as string[] });

/**
 * `from` and `to` are inclusive on purpose: the console sends the first and the
 * last instant of the period it is showing, so a half-open interval would drop
 * the final day's activity.
 */
class DateRangeQuery {
  @ApiPropertyOptional({ format: 'date-time', description: 'Inclusive lower bound, ISO 8601' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'Inclusive upper bound; KPIs default to now' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class ListAdminAuditQuery extends PageQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Only actions by this admin' })
  @IsOptional()
  @IsUUID()
  adminId?: string;

  @ApiPropertyOptional({ description: 'Exact action key, e.g. withdrawal.resolve' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;

  @ApiPropertyOptional({ description: 'Entity kind, e.g. user, config, order' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  entity?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only actions that touched this row' })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class ListAdminOrdersQuery extends PageQueryDto {
  @ApiPropertyOptional(queryEnum(orderStatusEnum.enumValues))
  @IsOptional()
  @IsIn(orderStatusEnum.enumValues)
  status?: (typeof orderStatusEnum.enumValues)[number];

  @ApiPropertyOptional({ format: 'uuid', description: 'Orders where this account is the hirer' })
  @IsOptional()
  @IsUUID()
  hirerId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Orders where this account is the player' })
  @IsOptional()
  @IsUUID()
  playerId?: string;

  @ApiPropertyOptional({ description: 'Search the hirer or player name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ['createdAt', 'startsAt', 'endedAt'] })
  @IsOptional()
  @IsIn(['createdAt', 'startsAt', 'endedAt'])
  sort?: 'createdAt' | 'startsAt' | 'endedAt';

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class ListAdminLedgerQuery extends PageQueryDto {
  @ApiPropertyOptional(queryEnum(ledgerAccountEnum.enumValues))
  @IsOptional()
  @IsIn(ledgerAccountEnum.enumValues)
  accountType?: (typeof ledgerAccountEnum.enumValues)[number];

  @ApiPropertyOptional(queryEnum(ledgerTypeEnum.enumValues))
  @IsOptional()
  @IsIn(ledgerTypeEnum.enumValues)
  type?: (typeof ledgerTypeEnum.enumValues)[number];

  @ApiPropertyOptional(queryEnum(ledgerDirectionEnum.enumValues))
  @IsOptional()
  @IsIn(ledgerDirectionEnum.enumValues)
  direction?: (typeof ledgerDirectionEnum.enumValues)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Wallet that owns the entry' })
  @IsOptional()
  @IsUUID()
  walletId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ minimum: 0, description: 'Only entries whose amount is at least this (VND)' })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  minAmount?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Only entries whose amount is at most this (VND)' })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  maxAmount?: number;
}

export class ListAdminWalletsQuery extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Search the account name or email' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'Only wallets with money waiting to be released' })
  @IsOptional()
  @IsIn(['true', 'false'])
  pendingOnly?: 'true' | 'false';
}

export class ListAdminDepositsQuery extends PageQueryDto {
  @ApiPropertyOptional(queryEnum(depositStatusEnum.enumValues))
  @IsOptional()
  @IsIn(depositStatusEnum.enumValues)
  status?: (typeof depositStatusEnum.enumValues)[number];

  @ApiPropertyOptional({ description: 'Search the account name or email' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ minimum: 0, description: 'Only deposits of at least this amount (VND)' })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  minAmount?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Only deposits of at most this amount (VND)' })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  maxAmount?: number;
}

export class ListAdminEscrowsQuery extends PageQueryDto {
  @ApiPropertyOptional(queryEnum(escrowStatusEnum.enumValues))
  @IsOptional()
  @IsIn(escrowStatusEnum.enumValues)
  status?: (typeof escrowStatusEnum.enumValues)[number];
}

export class AdminKpisQuery extends DateRangeQuery {}

export class AdminAuditActorDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true, description: 'Null when the row predates the tier column' })
  adminRole: string | null;
}

export class AdminPartyRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;
}

export class AdminAuditLogView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: AdminAuditActorDto, nullable: true, description: 'Null once the account is deleted' })
  admin: AdminAuditActorDto | null;

  @ApiProperty({ example: 'withdrawal.resolve' })
  action: string;

  @ApiProperty({ example: 'withdrawal' })
  entity: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  entityId: string | null;

  @ApiProperty({ nullable: true })
  reason: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  detail: Record<string, unknown> | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class AdminAuditLogPage {
  @ApiProperty({ type: [AdminAuditLogView] })
  items: AdminAuditLogView[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class AdminOrderRowDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty(queryEnum(orderStatusEnum.enumValues))
  status: (typeof orderStatusEnum.enumValues)[number];

  @ApiProperty({ nullable: true })
  closeReason: string | null;

  @ApiProperty({ nullable: true })
  endedEarlyBy: string | null;

  @ApiProperty({ type: AdminPartyRefDto })
  hirer: AdminPartyRefDto;

  @ApiProperty({ type: AdminPartyRefDto })
  player: AdminPartyRefDto;

  @ApiProperty()
  hours: number;

  @ApiProperty({ description: 'VND per hour' })
  hourlyRate: number;

  @ApiProperty({ description: 'VND charged to the hirer' })
  totalPrice: number;

  @ApiProperty({ description: 'Basis points kept by the platform' })
  feeBps: number;

  @ApiProperty({ nullable: true, description: 'VND paid to the player once settled' })
  playerPayout: number | null;

  @ApiProperty({ type: [AdminPartyRefDto], description: 'Games requested on this order' })
  games: AdminPartyRefDto[];

  @ApiProperty({ format: 'date-time', nullable: true })
  startsAt: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  scheduledEndAt: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  endedAt: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  disputedAt: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class AdminOrderPage {
  @ApiProperty({ type: [AdminOrderRowDto] })
  items: AdminOrderRowDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class AdminOrderHistoryItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ nullable: true })
  fromStatus: string | null;

  @ApiProperty()
  toStatus: string;

  @ApiProperty({ type: AdminPartyRefDto, nullable: true })
  actor: AdminPartyRefDto | null;

  @ApiProperty({ nullable: true })
  reason: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class AdminOrderEscrowDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty(queryEnum(escrowStatusEnum.enumValues))
  status: (typeof escrowStatusEnum.enumValues)[number];

  @ApiProperty()
  amount: number;

  @ApiProperty()
  settledAmount: number;

  @ApiProperty()
  refundedAmount: number;

  @ApiProperty({ description: 'VND still held for the hirer' })
  heldAmount: number;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

export class AdminOrderLedgerDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', description: 'Groups the debit and the credit of one movement' })
  transactionId: string;

  @ApiProperty(queryEnum(ledgerAccountEnum.enumValues))
  accountType: (typeof ledgerAccountEnum.enumValues)[number];

  @ApiProperty(queryEnum(ledgerDirectionEnum.enumValues))
  direction: (typeof ledgerDirectionEnum.enumValues)[number];

  @ApiProperty(queryEnum(ledgerTypeEnum.enumValues))
  type: (typeof ledgerTypeEnum.enumValues)[number];

  @ApiProperty()
  amount: number;

  @ApiProperty({ nullable: true })
  note: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class AdminOrderPendingCreditDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  amount: number;

  @ApiProperty({ format: 'date-time' })
  availableAt: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  releasedAt: string | null;
}

export class AdminOrderRatingDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: AdminPartyRefDto })
  rater: AdminPartyRefDto;

  @ApiProperty({ type: AdminPartyRefDto })
  ratee: AdminPartyRefDto;

  @ApiProperty({ minimum: 1, maximum: 5 })
  rate: number;

  @ApiProperty({ nullable: true })
  comment: string | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ enum: ['NONE', 'FLAGGED', 'UPHELD', 'DISMISSED'] })
  violationStatus: 'NONE' | 'FLAGGED' | 'UPHELD' | 'DISMISSED';

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class AdminOrderReportDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: AdminPartyRefDto })
  reporter: AdminPartyRefDto;

  @ApiProperty({ type: AdminPartyRefDto })
  target: AdminPartyRefDto;

  @ApiProperty()
  message: string;

  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  status: 'PENDING' | 'APPROVED' | 'REJECTED';

  @ApiProperty({ nullable: true })
  resolutionNote: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class AdminOrderDetailDto {
  @ApiProperty({ type: AdminOrderRowDto })
  order: AdminOrderRowDto;

  @ApiProperty({ maxLength: 500 })
  message: string;

  @ApiProperty({ nullable: true })
  reason: string | null;

  @ApiProperty({ type: [AdminOrderHistoryItemDto] })
  history: AdminOrderHistoryItemDto[];

  @ApiProperty({ type: AdminOrderEscrowDto, nullable: true })
  escrow: AdminOrderEscrowDto | null;

  @ApiProperty({ type: [AdminOrderLedgerDto] })
  ledger: AdminOrderLedgerDto[];

  @ApiProperty({ type: [AdminOrderPendingCreditDto] })
  pendingCredits: AdminOrderPendingCreditDto[];

  @ApiProperty({ type: [AdminOrderRatingDto] })
  ratings: AdminOrderRatingDto[];

  @ApiProperty({ type: [AdminOrderReportDto] })
  reports: AdminOrderReportDto[];

  @ApiProperty({
    nullable: true,
    description: 'Hours the payout can still be objected to; null once the order left DISPUTED',
  })
  disputeWindowHours: number | null;

  @ApiProperty({ format: 'date-time', nullable: true, description: 'When the DISPUTED window closes' })
  disputeClosesAt: string | null;
}

export class AdminLedgerView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  transactionId: string;

  @ApiProperty(queryEnum(ledgerAccountEnum.enumValues))
  accountType: (typeof ledgerAccountEnum.enumValues)[number];

  @ApiProperty(queryEnum(ledgerDirectionEnum.enumValues))
  direction: (typeof ledgerDirectionEnum.enumValues)[number];

  @ApiProperty(queryEnum(ledgerTypeEnum.enumValues))
  type: (typeof ledgerTypeEnum.enumValues)[number];

  @ApiProperty()
  amount: number;

  @ApiProperty({ nullable: true })
  note: string | null;

  @ApiProperty({ nullable: true, description: 'Who the entry belongs to: person, charity, escrow or platform' })
  holder: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  orderId: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class AdminLedgerTotalsDto {
  @ApiProperty({ description: 'VND summed over the whole filtered set, not just this page' })
  debits: number;

  @ApiProperty({ description: 'VND summed over the whole filtered set, not just this page' })
  credits: number;

  @ApiProperty()
  entries: number;
}

export class AdminLedgerPage {
  @ApiProperty({ type: [AdminLedgerView] })
  items: AdminLedgerView[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;

  @ApiProperty({ type: AdminLedgerTotalsDto })
  totals: AdminLedgerTotalsDto;
}

export class AdminWalletView {
  @ApiProperty({ format: 'uuid' })
  walletId: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  availableBalance: number;

  @ApiProperty({ description: 'VND earned but still inside the release window' })
  pendingAmount: number;

  @ApiProperty()
  pendingCount: number;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

export class AdminWalletPage {
  @ApiProperty({ type: [AdminWalletView] })
  items: AdminWalletView[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class AdminDepositView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: AdminPartyRefDto })
  user: AdminPartyRefDto;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  provider: string;

  @ApiProperty({ nullable: true })
  providerTxnId: string | null;

  @ApiProperty(queryEnum(depositStatusEnum.enumValues))
  status: (typeof depositStatusEnum.enumValues)[number];

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  completedAt: string | null;
}

export class AdminDepositPage {
  @ApiProperty({ type: [AdminDepositView] })
  items: AdminDepositView[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class AdminEscrowView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  orderId: string;

  @ApiProperty(queryEnum(orderStatusEnum.enumValues))
  orderStatus: (typeof orderStatusEnum.enumValues)[number];

  @ApiProperty({ type: AdminPartyRefDto })
  hirer: AdminPartyRefDto;

  @ApiProperty({ type: AdminPartyRefDto })
  player: AdminPartyRefDto;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  settledAmount: number;

  @ApiProperty()
  refundedAmount: number;

  @ApiProperty()
  heldAmount: number;

  @ApiProperty(queryEnum(escrowStatusEnum.enumValues))
  status: (typeof escrowStatusEnum.enumValues)[number];

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class AdminEscrowPage {
  @ApiProperty({ type: [AdminEscrowView] })
  items: AdminEscrowView[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;

  @ApiProperty({ description: 'VND still held across every escrow, not just this page' })
  totalHeld: number;
}

export class KpiOrderBlock {
  @ApiProperty()
  created: number;

  @ApiProperty()
  settled: number;

  @ApiProperty()
  endedEarly: number;

  @ApiProperty()
  disputed: number;

  @ApiProperty()
  closed: number;

  @ApiProperty({ description: 'Sessions that actually ran to the end inside the period' })
  completed: number;

  @ApiProperty({
    description: 'Share of finished sessions that were cut short, in basis points (0..10000)',
  })
  endedEarlyRateBps: number;
}

export class KpiMoneyBlock {
  @ApiProperty({ description: 'VND handed to players for orders settled in the period' })
  playerPayouts: number;

  @ApiProperty({ description: 'VND kept by the platform for orders settled in the period' })
  platformFees: number;

  @ApiProperty({ description: 'VND refunded to hirers in the period' })
  refunds: number;

  @ApiProperty({ description: 'VND of payouts marked PAID in the period' })
  payoutsPaid: number;

  @ApiProperty({ description: 'VND of charity payouts marked PAID in the period' })
  charityPayoutsPaid: number;

  @ApiProperty({ description: 'VND deposited and SUCCEEDED in the period' })
  depositsSucceeded: number;

  @ApiProperty({ description: 'VND donated in the period' })
  donations: number;
}

export class KpiQueueBlock {
  @ApiProperty()
  pendingUserWithdrawals: number;

  @ApiProperty()
  pendingUserWithdrawalAmount: number;

  @ApiProperty()
  pendingCharityWithdrawals: number;

  @ApiProperty()
  pendingCharityWithdrawalAmount: number;

  @ApiProperty({ description: 'VND held in escrow right now' })
  escrowHeld: number;

  @ApiProperty({ description: 'VND waiting for its release window' })
  pendingCredits: number;

  @ApiProperty()
  pendingReports: number;

  @ApiProperty()
  pendingFeedback: number;

  @ApiProperty()
  flaggedRatings: number;
}

export class KpiPeopleBlock {
  @ApiProperty()
  registered: number;

  @ApiProperty()
  activePlayers: number;

  @ApiProperty()
  ratingsCreated: number;

  @ApiProperty({ minimum: 0, maximum: 5, nullable: true, description: 'Mean of ratings written in the period' })
  averageRating: number | null;
}

export class AdminKpisDto {
  @ApiProperty({ format: 'date-time' })
  from: string;

  @ApiProperty({ format: 'date-time' })
  to: string;

  @ApiProperty({ type: KpiOrderBlock })
  orders: KpiOrderBlock;

  @ApiProperty({ type: KpiMoneyBlock })
  money: KpiMoneyBlock;

  @ApiProperty({ type: KpiQueueBlock })
  queue: KpiQueueBlock;

  @ApiProperty({ type: KpiPeopleBlock })
  people: KpiPeopleBlock;
}

export class AdminUserWalletBlock {
  @ApiProperty({ format: 'uuid' })
  walletId: string;

  @ApiProperty({ description: 'VND the account can spend or withdraw right now' })
  availableBalance: number;

  @ApiProperty({ description: 'VND earned but still inside its release window' })
  pendingAmount: number;

  @ApiProperty()
  pendingCount: number;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

export class AdminUserBehaviorBlock {
  @ApiProperty({ minimum: 0, maximum: 100 })
  points: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  satisfaction: number;

  @ApiProperty({
    type: [BehaviorHistoryItemDto],
    description: 'Newest first, at most the twenty last movements',
  })
  history: BehaviorHistoryItemDto[];
}

export class AdminUserOrderBlock {
  @ApiProperty({ description: 'Sessions this account hired somebody for' })
  asHirer: number;

  @ApiProperty({ description: 'Sessions this account played in' })
  asPlayer: number;

  @ApiProperty({ description: 'Sessions in either role that have not reached an end' })
  open: number;

  @ApiProperty({ type: [AdminOrderRowDto], description: 'Five newest sessions in either role' })
  recent: AdminOrderRowDto[];
}

export class AdminUserModerationBlock {
  @ApiProperty({ description: 'Reports naming this account that no decision has been made on' })
  openReportsAgainst: number;

  @ApiProperty({ description: 'Reports this account filed against somebody else' })
  reportsFiled: number;

  @ApiProperty({ description: 'Ratings received that are currently flagged' })
  flaggedRatings: number;

  @ApiProperty({ description: 'Payout requests still waiting for finance' })
  pendingWithdrawals: number;

  @ApiProperty({ description: 'VND waiting to be paid out across those requests' })
  pendingWithdrawalAmount: number;
}

/** Everything needed to decide on one account without opening five other pages. */
export class AdminUserDossierDto {
  @ApiProperty({ type: UserSummary, description: 'Account view with the email and back-office tier' })
  account: UserSummary;

  @ApiProperty({ type: AdminUserBehaviorBlock })
  behavior: AdminUserBehaviorBlock;

  @ApiProperty({ type: AdminUserWalletBlock, nullable: true })
  wallet: AdminUserWalletBlock | null;

  @ApiProperty({ type: AdminUserOrderBlock })
  orders: AdminUserOrderBlock;

  @ApiProperty({ type: AdminUserModerationBlock })
  moderation: AdminUserModerationBlock;
}
