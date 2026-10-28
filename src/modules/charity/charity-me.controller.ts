import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { Roles } from '../../common/security/decorators';
import { CharityService } from './charity.service';
import {
  CharityView,
  CharityWithdrawalPage,
  CharityWithdrawalView,
  CreateCharityWithdrawalDto,
  DonationPage,
  ListCharityWithdrawalsQuery,
  ListDonationsQuery,
  UpdateCharityDto,
} from './charity.dto';

@ApiTags('charities')
@ApiBearerAuth()
@Controller('me')
export class CharityMeController {
  constructor(private readonly charities: CharityService) {}

  @Roles('USER')
  @Get('donations')
  @ApiOperation({ summary: 'Donations I made' })
  @ApiOkResponse({ type: DonationPage })
  myDonations(@CurrentUser() user: AuthUser, @Query() query: ListDonationsQuery) {
    return this.charities.myDonations(user.id, query);
  }

  @Roles('CHARITY')
  @Get('charity')
  @ApiOperation({ summary: 'My charity profile' })
  @ApiOkResponse({ type: CharityView })
  profile(@CurrentUser() user: AuthUser) {
    return this.charities.byUser(user.id);
  }

  @Roles('CHARITY')
  @Patch('charity')
  @ApiOperation({ summary: 'Update my charity profile' })
  @ApiOkResponse({ type: CharityView })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateCharityDto) {
    return this.charities.updateProfile(user.id, dto);
  }

  @Roles('CHARITY')
  @Get('charity/donations')
  @ApiOperation({ summary: 'Donations my charity received' })
  @ApiOkResponse({ type: DonationPage })
  received(@CurrentUser() user: AuthUser, @Query() query: ListDonationsQuery) {
    return this.charities.receivedDonations(user.id, query);
  }

  @Roles('CHARITY')
  @Get('charity/withdrawals')
  @ApiOperation({ summary: 'My charity withdrawal requests' })
  @ApiOkResponse({ type: CharityWithdrawalPage })
  withdrawals(@CurrentUser() user: AuthUser, @Query() query: ListCharityWithdrawalsQuery) {
    return this.charities.listMyWithdrawals(user.id, query);
  }

  @Roles('CHARITY')
  @Post('charity/withdrawals')
  @ApiOperation({ summary: 'Request a payout from the charity balance' })
  @ApiCreatedResponse({ type: CharityWithdrawalView })
  requestWithdrawal(@CurrentUser() user: AuthUser, @Body() dto: CreateCharityWithdrawalDto) {
    return this.charities.requestWithdrawal(user.id, dto.amount, dto.note);
  }

  @Roles('CHARITY')
  @Post('charity/withdrawals/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a pending payout request' })
  @ApiOkResponse({ type: CharityWithdrawalView })
  cancelWithdrawal(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.charities.cancelWithdrawal(user.id, id);
  }
}
