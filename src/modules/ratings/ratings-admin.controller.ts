import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { Roles } from '../../common/security/decorators';
import { ListFlaggedRatingsQuery, ResolveViolationDto } from './ratings.dto';
import { RatingsService } from './ratings.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/ratings')
export class RatingsAdminController {
  constructor(private readonly ratings: RatingsService) {}

  @Get('flagged')
  @ApiOperation({ summary: 'List ratings flagged for review' })
  flagged(@Query() query: ListFlaggedRatingsQuery) {
    return this.ratings.listFlagged(query);
  }

  @Patch(':id/violation')
  @ApiOperation({ summary: 'Uphold or dismiss a flagged rating' })
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) ratingId: string,
    @Body() dto: ResolveViolationDto,
  ) {
    return this.ratings.resolveViolation(user.id, ratingId, dto);
  }
}
