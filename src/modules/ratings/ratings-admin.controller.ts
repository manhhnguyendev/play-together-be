import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '../../common/pagination/pagination';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { Roles } from '../../common/security/decorators';
import { ListFlaggedRatingsQuery, RatingDto, RatingPage, ResolveViolationDto } from './ratings.dto';
import { RatingsService } from './ratings.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/ratings')
export class RatingsAdminController {
  constructor(private readonly ratings: RatingsService) {}

  @Get('flagged')
  @ApiOperation({ summary: 'List ratings flagged for review' })
  @ApiOkResponse({ type: RatingPage })
  flagged(@Query() query: ListFlaggedRatingsQuery): Promise<Paginated<RatingDto>> {
    return this.ratings.listFlagged(query);
  }

  @Patch(':id/violation')
  @ApiOperation({ summary: 'Uphold or dismiss a flagged rating' })
  @ApiOkResponse({ type: RatingDto })
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) ratingId: string,
    @Body() dto: ResolveViolationDto,
  ): Promise<RatingDto> {
    return this.ratings.resolveViolation(user.id, ratingId, dto);
  }
}
