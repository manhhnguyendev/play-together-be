import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { Roles } from '../../common/security/decorators';
import { CharityService } from './charity.service';
import {
  CreateCharityAccountDto,
  ListAdminCharitiesQuery,
  ListCharityWithdrawalsQuery,
  ResolveCharityWithdrawalDto,
  UpdateCharityAsAdminDto,
} from './charity.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class CharityAdminController {
  constructor(private readonly charities: CharityService) {}

  @Get('charities')
  @ApiOperation({ summary: 'List every charity, including inactive ones' })
  list(@Query() query: ListAdminCharitiesQuery) {
    return this.charities.adminList(query);
  }

  @Post('charities')
  @ApiOperation({ summary: 'Create a charity account and profile' })
  create(@Body() dto: CreateCharityAccountDto) {
    return this.charities.adminCreate(dto);
  }

  @Patch('charities/:id')
  @ApiOperation({ summary: 'Update a charity profile or activation state' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCharityAsAdminDto) {
    return this.charities.adminUpdate(id, dto);
  }

  @Get('charity-withdrawals')
  @ApiOperation({ summary: 'Charity payout queue' })
  withdrawals(@Query() query: ListCharityWithdrawalsQuery) {
    return this.charities.adminListWithdrawals(query);
  }

  @Patch('charity-withdrawals/:id')
  @ApiOperation({ summary: 'Mark a charity payout as paid or rejected' })
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveCharityWithdrawalDto,
  ) {
    return this.charities.adminResolveWithdrawal(user.id, id, dto);
  }
}
