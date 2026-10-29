import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/security/current-user.decorator';
import type { AuthUser } from '../../common/security/auth-user';
import { Public } from '../../common/security/decorators';
import { PageQueryDto } from '../../common/pagination/pagination';
import { BehaviorView } from '../users/users.dto';
import { BehaviorHistoryPage } from './behavior.dto';
import { BehaviorService } from './behavior.service';

@ApiTags('behavior')
@Controller('users')
export class BehaviorController {
  constructor(private readonly behavior: BehaviorService) {}

  @ApiBearerAuth()
  @Get('me/behavior')
  @ApiOperation({ summary: 'My behavior points' })
  @ApiOkResponse({ type: BehaviorView })
  mine(@CurrentUser() user: AuthUser) {
    return this.behavior.get(user.id);
  }

  @ApiBearerAuth()
  @Get('me/behavior/history')
  @ApiOperation({ summary: 'My behavior point history, newest first' })
  @ApiOkResponse({ type: BehaviorHistoryPage })
  myHistory(@CurrentUser() user: AuthUser, @Query() query: PageQueryDto) {
    return this.behavior.history(user.id, query);
  }

  @Public()
  @Get(':id/behavior')
  @ApiOperation({ summary: 'Behavior points of a user' })
  @ApiOkResponse({ type: BehaviorView })
  byUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.behavior.get(id);
  }
}
