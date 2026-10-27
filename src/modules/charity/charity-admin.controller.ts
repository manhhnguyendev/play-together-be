import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Paginated } from '../../common/pagination/pagination';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { Roles } from '../../common/security/decorators';
import { CharityService } from './charity.service';
import {
  CharityPage,
  CharityView,
  CharityWithdrawalPage,
  CharityWithdrawalView,
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
  @ApiOkResponse({ type: CharityPage })
  list(@Query() query: ListAdminCharitiesQuery): Promise<Paginated<CharityView>> {
    return this.charities.adminList(query);
  }

  @Post('charities')
  @ApiOperation({ summary: 'Create a charity account and profile' })
  @ApiCreatedResponse({ type: CharityView })
  create(@Body() dto: CreateCharityAccountDto): Promise<CharityView> {
    return this.charities.adminCreate(dto);
  }

  @Patch('charities/:id')
  @ApiOperation({ summary: 'Update a charity profile or activation state' })
  @ApiOkResponse({ type: CharityView })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCharityAsAdminDto): Promise<CharityView> {
    return this.charities.adminUpdate(id, dto);
  }

  @Get('charity-withdrawals')
  @ApiOperation({ summary: 'Charity payout queue' })
  @ApiOkResponse({ type: CharityWithdrawalPage })
  withdrawals(
    @Query() query: ListCharityWithdrawalsQuery,
  ): Promise<Paginated<CharityWithdrawalView>> {
    return this.charities.adminListWithdrawals(query);
  }

  @Patch('charity-withdrawals/:id')
  @ApiOperation({ summary: 'Mark a charity payout as paid or rejected' })
  @ApiOkResponse({ type: CharityWithdrawalView })
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveCharityWithdrawalDto,
  ): Promise<CharityWithdrawalView> {
    return this.charities.adminResolveWithdrawal(user.id, id, dto);
  }
}
