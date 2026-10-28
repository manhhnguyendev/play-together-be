import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import {
  CreateFeedbackDto,
  FeedbackPage,
  ListMyFeedbackQuery,
  MyFeedbackView,
} from './feedback.dto';
import { FeedbackService } from './feedback.service';

@ApiTags('feedback')
@ApiBearerAuth()
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @ApiOperation({ summary: 'Submit product feedback or a complaint' })
  @ApiCreatedResponse({ type: MyFeedbackView })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFeedbackDto) {
    return this.feedbackService.create(user.id, dto);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Feedback I submitted' })
  @ApiOkResponse({ type: FeedbackPage })
  mine(@CurrentUser() user: AuthUser, @Query() query: ListMyFeedbackQuery) {
    return this.feedbackService.listMine(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One feedback item I submitted' })
  @ApiOkResponse({ type: MyFeedbackView })
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.feedbackService.getMine(user.id, id);
  }
}
