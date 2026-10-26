import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { CreateFeedbackDto, ListMyFeedbackQuery } from './feedback.dto';
import { FeedbackService } from './feedback.service';

@ApiTags('feedback')
@ApiBearerAuth()
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @ApiOperation({ summary: 'Submit product feedback or a complaint' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFeedbackDto) {
    return this.feedbackService.create(user.id, dto);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Feedback I submitted' })
  mine(@CurrentUser() user: AuthUser, @Query() query: ListMyFeedbackQuery) {
    return this.feedbackService.listMine(user.id, query);
  }
}
