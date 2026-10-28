import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/security/current-user.decorator';
import type { AuthUser } from '../../common/security/auth-user';
import {
  ListNotificationsQuery,
  NotificationDeletedCountDto,
  NotificationDto,
  NotificationPage,
  NotificationUpdatedCountDto,
} from './notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List my notifications' })
  @ApiOkResponse({ type: NotificationPage })
  list(@CurrentUser() user: AuthUser, @Query() query: ListNotificationsQuery) {
    return this.notifications.list(user.id, query.page, query.pageSize, query.status);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Number of unread notifications' })
  @ApiOkResponse({ schema: { properties: { unread: { type: 'number' } } } })
  async unreadCount(@CurrentUser() user: AuthUser): Promise<{ unread: number }> {
    return { unread: await this.notifications.unreadCount(user.id) };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  @ApiOkResponse({ type: NotificationDto })
  markRead(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user.id, id);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark every notification as read' })
  @ApiOkResponse({ type: NotificationUpdatedCountDto })
  async markAllRead(@CurrentUser() user: AuthUser): Promise<{ updated: number }> {
    return { updated: await this.notifications.markAllRead(user.id) };
  }

  @Delete('read')
  @ApiOperation({ summary: 'Delete all read notifications' })
  @ApiOkResponse({ type: NotificationDeletedCountDto })
  async removeRead(@CurrentUser() user: AuthUser): Promise<{ deleted: number }> {
    return { deleted: await this.notifications.removeAllRead(user.id) };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a notification' })
  @ApiNoContentResponse()
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.notifications.remove(user.id, id);
  }
}
