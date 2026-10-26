import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { Public } from '../../common/security/decorators';
import { CharityService } from './charity.service';
import { CreateDonationDto, ListCharitiesQuery, ListDonationsQuery } from './charity.dto';

@ApiTags('charities')
@Controller('charities')
export class CharitiesController {
  constructor(private readonly charities: CharityService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Browse active charities' })
  list(@Query() query: ListCharitiesQuery) {
    return this.charities.list(query);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Charity detail and fundraising stats' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.charities.get(id);
  }

  @ApiBearerAuth()
  @Get(':id/donations')
  @ApiOperation({ summary: 'Donations received by a charity' })
  donations(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListDonationsQuery,
  ) {
    return this.charities.donationsForCharity(id, user, query);
  }

  @ApiBearerAuth()
  @Post(':id/donations')
  @ApiOperation({ summary: 'Donate to a charity from your wallet' })
  donate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDonationDto,
  ) {
    return this.charities.donate(user, id, dto.amount, dto.message);
  }
}
