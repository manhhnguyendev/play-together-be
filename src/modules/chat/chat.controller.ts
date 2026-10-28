import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PageQueryDto } from '../../common/pagination/pagination';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { ChatService } from './chat.service';
import { ChatMessagePage, ChatMessageView, ConversationView, SendMessageDto } from './chat.dto';

@ApiTags('chat')
@ApiBearerAuth()
@Controller('chats')
export class ChatController {
  constructor(private readonly chats: ChatService) {}

  @Get()
  @ApiOperation({ summary: 'Conversation list with the latest message per user' })
  @ApiOkResponse({ type: [ConversationView] })
  conversations(@CurrentUser() user: AuthUser) {
    return this.chats.conversations(user.id);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Message history with a user, newest first' })
  @ApiOkResponse({ type: ChatMessagePage })
  conversation(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: PageQueryDto,
  ) {
    return this.chats.conversation(user.id, userId, query.page, query.pageSize);
  }

  @Post(':userId/messages')
  @ApiOperation({ summary: 'Send a direct message' })
  @ApiCreatedResponse({ type: ChatMessageView })
  send(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chats.send(user.id, userId, dto.message);
  }

  @Post('messages/:id/recall')
  @HttpCode(200)
  @ApiOperation({ summary: 'Recall a message you sent' })
  @ApiOkResponse({ type: ChatMessageView })
  recall(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chats.recall(user.id, id);
  }
}
