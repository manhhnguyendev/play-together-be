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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { CreateDepositDto, ListTransactionsQuery, ListWithdrawalsQuery, RequestWithdrawalDto } from './wallet.dto';
import { WalletService } from './wallet.service';

@ApiTags('wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'My wallet balances and upcoming releases' })
  summary(@CurrentUser() user: AuthUser) {
    return this.wallet.getSummary(user.id);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'My ledger entries (newest first)' })
  transactions(@CurrentUser() user: AuthUser, @Query() query: ListTransactionsQuery) {
    return this.wallet.listTransactions(user.id, query);
  }

  @Get('deposits')
  @ApiOperation({ summary: 'My top-ups' })
  deposits(@CurrentUser() user: AuthUser, @Query() query: ListTransactionsQuery) {
    return this.wallet.listDeposits(user.id, query.page, query.pageSize);
  }

  @Post('deposits')
  @ApiOperation({ summary: 'Start a MoMo top-up and receive the payment URL' })
  createDeposit(@CurrentUser() user: AuthUser, @Body() dto: CreateDepositDto) {
    return this.wallet.createDeposit(user.id, dto.amount);
  }

  @Post('deposits/:id/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm a top-up manually (mock payment adapter only)' })
  confirmDeposit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.wallet.confirmDeposit(user.id, id);
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'My withdrawal requests' })
  withdrawals(@CurrentUser() user: AuthUser, @Query() query: ListWithdrawalsQuery) {
    return this.wallet.listWithdrawals(user.id, query);
  }

  @Post('withdrawals')
  @ApiOperation({ summary: 'Request a withdrawal from my available balance' })
  requestWithdrawal(@CurrentUser() user: AuthUser, @Body() dto: RequestWithdrawalDto) {
    return this.wallet.requestWithdrawal(user.id, dto);
  }

  @Post('withdrawals/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a still-pending withdrawal request' })
  cancelWithdrawal(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.wallet.cancelWithdrawal(user.id, id);
  }
}
