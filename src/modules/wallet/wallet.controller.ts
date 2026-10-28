import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import {
  CreateDepositDto,
  DepositPage,
  DepositStartView,
  EarningsSummaryDto,
  ListTransactionsQuery,
  ListWithdrawalsQuery,
  MyWithdrawalPage,
  ReleasePendingCreditsResultDto,
  RequestWithdrawalDto,
  StatusResultView,
  TransactionPage,
  WalletSummary,
} from './wallet.dto';
import { WalletService } from './wallet.service';

@ApiTags('wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'My wallet balances and upcoming releases' })
  @ApiOkResponse({ type: WalletSummary })
  summary(@CurrentUser() user: AuthUser) {
    return this.wallet.getSummary(user.id);
  }

  @Post('pending-credits/release')
  @HttpCode(200)
  @ApiOperation({ summary: 'Move my matured pending credits into the available balance' })
  @ApiOkResponse({ type: ReleasePendingCreditsResultDto })
  releasePendingCredits(@CurrentUser() user: AuthUser) {
    return this.wallet.releaseDueCredits(user.id);
  }

  @Get('earnings/summary')
  @ApiOperation({ summary: 'My player earnings for today, this month and all time' })
  @ApiOkResponse({ type: EarningsSummaryDto })
  earnings(@CurrentUser() user: AuthUser) {
    return this.wallet.earningsSummary(user.id);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'My ledger entries (newest first)' })
  @ApiOkResponse({ type: TransactionPage })
  transactions(@CurrentUser() user: AuthUser, @Query() query: ListTransactionsQuery) {
    return this.wallet.listTransactions(user.id, query);
  }

  @Get('deposits')
  @ApiOperation({ summary: 'My top-ups' })
  @ApiOkResponse({ type: DepositPage })
  deposits(@CurrentUser() user: AuthUser, @Query() query: ListTransactionsQuery) {
    return this.wallet.listDeposits(user.id, query.page, query.pageSize);
  }

  @Post('deposits')
  @ApiOperation({ summary: 'Start a MoMo top-up and receive the payment URL' })
  @ApiCreatedResponse({ type: DepositStartView })
  createDeposit(@CurrentUser() user: AuthUser, @Body() dto: CreateDepositDto) {
    return this.wallet.createDeposit(user.id, dto.amount);
  }

  @Post('deposits/:id/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm a top-up manually (mock payment adapter only)' })
  @ApiOkResponse({ type: StatusResultView })
  confirmDeposit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.wallet.confirmDeposit(user.id, id);
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'My withdrawal requests' })
  @ApiOkResponse({ type: MyWithdrawalPage })
  withdrawals(@CurrentUser() user: AuthUser, @Query() query: ListWithdrawalsQuery) {
    return this.wallet.listWithdrawals(user.id, query);
  }

  @Post('withdrawals')
  @ApiOperation({ summary: 'Request a withdrawal from my available balance' })
  @ApiCreatedResponse({ type: StatusResultView })
  requestWithdrawal(@CurrentUser() user: AuthUser, @Body() dto: RequestWithdrawalDto) {
    return this.wallet.requestWithdrawal(user.id, dto);
  }

  @Post('withdrawals/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a still-pending withdrawal request' })
  @ApiOkResponse({ type: StatusResultView })
  cancelWithdrawal(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.wallet.cancelWithdrawal(user.id, id);
  }
}
