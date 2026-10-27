import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { Public } from '../../common/security/decorators';
import { CreateRatingDto, FlagRatingDto, ListRatingsQuery, RatingDto } from './ratings.dto';
import { RatingsService } from './ratings.service';

@ApiTags('ratings')
@Controller()
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Post('orders/:id/ratings')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Rate the other party of a finished order' })
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateRatingDto,
  ) {
    return this.ratings.create(user.id, orderId, dto.rate, dto.comment);
  }

  @Get('orders/:id/ratings')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ratings exchanged on one of my orders' })
  @ApiOkResponse({ type: [RatingDto] })
  listForOrder(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) orderId: string) {
    return this.ratings.listForOrder(orderId, user.id);
  }

  @Public()
  @Get('users/:id/ratings')
  @ApiOperation({ summary: 'Ratings received by a user' })
  list(@Param('id', ParseUUIDPipe) userId: string, @Query() query: ListRatingsQuery) {
    return this.ratings.listForUser(userId, query);
  }

  @Public()
  @Get('users/:id/ratings/summary')
  @ApiOperation({ summary: 'Aggregate rating score and distribution' })
  summary(@Param('id', ParseUUIDPipe) userId: string) {
    return this.ratings.summary(userId);
  }

  @Post('ratings/:id/flag')
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: 'Flag a received rating for moderator review' })
  flag(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) ratingId: string,
    @Body() dto: FlagRatingDto,
  ) {
    return this.ratings.flag(user.id, ratingId, dto.reason);
  }
}
