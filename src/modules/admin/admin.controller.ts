import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { Roles } from '../../common/security/decorators';
import { ListWithdrawalsQuery, ResolveWithdrawalDto } from '../wallet/wallet.dto';
import { AdminService } from './admin.service';
import {
  AdjustBehaviorDto,
  AdminUpdateUserDto,
  BroadcastNotificationDto,
  ListAdminFeedbackQuery,
  ListAdminUsersQuery,
  ResolveFeedbackDto,
  ToggleMaintenanceDto,
} from './admin.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Platform overview: users, orders, money and moderation load' })
  overview() {
    return this.admin.overview();
  }

  @Get('users')
  @ApiOperation({ summary: 'Search and filter user accounts' })
  users(@Query() query: ListAdminUsersQuery) {
    return this.admin.listUsers(query);
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Lock, unlock, re-role or change the presence of an account' })
  updateUser(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateUserDto,
  ) {
    return this.admin.updateUser(user.id, id, dto);
  }

  @Post('users/:id/behavior')
  @HttpCode(200)
  @ApiOperation({ summary: 'Manually adjust behavior and satisfaction points' })
  adjustBehavior(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustBehaviorDto,
  ) {
    return this.admin.adjustBehavior(user.id, id, dto.points, dto.satisfaction, dto.note);
  }

  @Get('feedback')
  @ApiOperation({ summary: 'Feedback queue' })
  feedback(@Query() query: ListAdminFeedbackQuery) {
    return this.admin.listFeedback(query);
  }

  @Patch('feedback/:id')
  @ApiOperation({ summary: 'Acknowledge or close a feedback entry' })
  resolveFeedback(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveFeedbackDto,
  ) {
    return this.admin.resolveFeedback(user.id, id, dto);
  }

  @Post('notifications/broadcast')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send an in-app notification to every active user' })
  broadcast(@Body() dto: BroadcastNotificationDto) {
    return this.admin.broadcast(dto.title, dto.body, dto.referenceUrl);
  }

  @Post('maintenance')
  @HttpCode(200)
  @ApiOperation({ summary: 'Turn maintenance mode on or off' })
  maintenance(@Body() dto: ToggleMaintenanceDto) {
    return this.admin.setMaintenance(dto.enabled);
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'User payout queue' })
  withdrawals(@Query() query: ListWithdrawalsQuery) {
    return this.admin.listWithdrawals(query);
  }

  @Patch('withdrawals/:id')
  @ApiOperation({ summary: 'Mark a user payout as paid or rejected' })
  resolveWithdrawal(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveWithdrawalDto) {
    return this.admin.resolveWithdrawal(id, dto.status, dto.note);
  }
}
