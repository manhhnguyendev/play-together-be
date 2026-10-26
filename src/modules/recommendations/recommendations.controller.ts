import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { ListRecommendationsQuery } from './recommendations.dto';
import { RecommendationsService } from './recommendations.service';

@ApiTags('recommendations')
@ApiBearerAuth()
@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get('players')
  @ApiOperation({ summary: 'Players matched to my hobbies and recent searches' })
  players(@CurrentUser() user: AuthUser, @Query() query: ListRecommendationsQuery) {
    return this.recommendations.forUser(user.id, query.limit);
  }
}
