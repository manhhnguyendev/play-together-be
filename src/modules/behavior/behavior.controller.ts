import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/security/current-user.decorator';
import type { AuthUser } from '../../common/security/auth-user';
import { Public } from '../../common/security/decorators';
import { BehaviorView } from '../users/users.dto';
import { BehaviorService } from './behavior.service';

@ApiTags('behavior')
@Controller('users')
export class BehaviorController {
  constructor(private readonly behavior: BehaviorService) {}

  @Get('me/behavior')
  @ApiOperation({ summary: 'My behavior points' })
  @ApiOkResponse({ type: BehaviorView })
  mine(@CurrentUser() user: AuthUser) {
    return this.behavior.get(user.id);
  }

  @Public()
  @Get(':id/behavior')
  @ApiOperation({ summary: 'Behavior points of a user' })
  @ApiOkResponse({ type: BehaviorView })
  byUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.behavior.get(id);
  }
}
