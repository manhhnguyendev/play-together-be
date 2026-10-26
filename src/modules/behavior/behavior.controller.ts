import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/security/current-user.decorator';
import type { AuthUser } from '../../common/security/auth-user';
import { Public } from '../../common/security/decorators';
import { BehaviorService } from './behavior.service';

@ApiTags('behavior')
@Controller('users')
export class BehaviorController {
  constructor(private readonly behavior: BehaviorService) {}

  @Get('me/behavior')
  @ApiOperation({ summary: 'My behavior points' })
  mine(@CurrentUser() user: AuthUser) {
    return this.behavior.get(user.id);
  }

  @Public()
  @Get(':id/behavior')
  @ApiOperation({ summary: 'Behavior points of a user' })
  byUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.behavior.get(id);
  }
}
