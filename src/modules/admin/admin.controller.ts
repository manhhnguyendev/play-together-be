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
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Paginated } from '../../common/pagination/pagination';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { Roles } from '../../common/security/decorators';
import { UserSummary } from '../users/users.dto';
import {
  ListWithdrawalsQuery,
  ResolveWithdrawalDto,
  WithdrawalResolutionDto,
  WithdrawalView,
  WithdrawalPage,
} from '../wallet/wallet.dto';
import { AdminService } from './admin.service';
import {
  AdjustBehaviorDto,
  AdminFeedbackPage,
  AdminFeedbackView,
  AdminUpdateUserDto,
  AdminUsersPage,
  BehaviorAdjustmentDto,
  BroadcastNotificationDto,
  BroadcastResultDto,
  ListAdminFeedbackQuery,
  ListAdminUsersQuery,
  MaintenanceStateDto,
  PlatformOverview,
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
  @ApiOkResponse({ type: PlatformOverview })
  overview(): Promise<PlatformOverview> {
    return this.admin.overview();
  }

  @Get('users')
  @ApiOperation({ summary: 'Search and filter user accounts' })
  @ApiOkResponse({ type: AdminUsersPage })
  users(@Query() query: ListAdminUsersQuery): Promise<Paginated<UserSummary>> {
    return this.admin.listUsers(query);
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Lock, unlock, re-role or change the presence of an account' })
  @ApiOkResponse({ type: UserSummary })
  updateUser(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateUserDto,
  ): Promise<UserSummary> {
    return this.admin.updateUser(user.id, id, dto);
  }

  @Post('users/:id/behavior')
  @HttpCode(200)
  @ApiOperation({ summary: 'Manually adjust behavior and satisfaction points' })
  @ApiOkResponse({ type: BehaviorAdjustmentDto })
  adjustBehavior(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustBehaviorDto,
  ): Promise<BehaviorAdjustmentDto> {
    return this.admin.adjustBehavior(user.id, id, dto.points, dto.satisfaction, dto.note);
  }

  @Get('feedback')
  @ApiOperation({ summary: 'Feedback queue' })
  @ApiOkResponse({ type: AdminFeedbackPage })
  feedback(@Query() query: ListAdminFeedbackQuery): Promise<Paginated<AdminFeedbackView>> {
    return this.admin.listFeedback(query);
  }

  @Patch('feedback/:id')
  @ApiOperation({ summary: 'Acknowledge or close a feedback entry' })
  @ApiOkResponse({ type: AdminFeedbackView })
  resolveFeedback(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveFeedbackDto,
  ): Promise<AdminFeedbackView> {
    return this.admin.resolveFeedback(user.id, id, dto);
  }

  @Post('notifications/broadcast')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send an in-app notification to every active user' })
  @ApiOkResponse({ type: BroadcastResultDto })
  broadcast(@Body() dto: BroadcastNotificationDto): Promise<BroadcastResultDto> {
    return this.admin.broadcast(dto.title, dto.body, dto.referenceUrl);
  }

  @Post('maintenance')
  @HttpCode(200)
  @ApiOperation({ summary: 'Turn maintenance mode on or off' })
  @ApiOkResponse({ type: MaintenanceStateDto })
  maintenance(@Body() dto: ToggleMaintenanceDto): Promise<MaintenanceStateDto> {
    return this.admin.setMaintenance(dto.enabled);
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'User payout queue' })
  @ApiOkResponse({ type: WithdrawalPage })
  withdrawals(@Query() query: ListWithdrawalsQuery): Promise<Paginated<WithdrawalView>> {
    return this.admin.listWithdrawals(query);
  }

  @Patch('withdrawals/:id')
  @ApiOperation({ summary: 'Mark a user payout as paid or rejected' })
  @ApiOkResponse({ type: WithdrawalResolutionDto })
  resolveWithdrawal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveWithdrawalDto,
  ): Promise<WithdrawalResolutionDto> {
    return this.admin.resolveWithdrawal(id, dto.status, dto.note);
  }
}
