import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { Public } from '../../common/security/decorators';
import {
  HotSearchItemDto,
  HotSearchQuery,
  ListSearchHistoryQuery,
  RecordSearchDto,
  SearchHistoryItem,
} from './search-history.dto';
import { SearchHistoryService } from './search-history.service';

@ApiTags('search-history')
@ApiBearerAuth()
@Controller('search-history')
export class SearchHistoryController {
  constructor(private readonly history: SearchHistoryService) {}

  @Public()
  @Get('hot')
  @ApiOperation({ summary: 'Trending player searches across the platform' })
  @ApiOkResponse({ type: [HotSearchItemDto] })
  hot(@Query() query: HotSearchQuery) {
    return this.history.hot(query.limit);
  }

  @Get()
  @ApiOperation({ summary: 'My recent player searches' })
  @ApiOkResponse({ type: [SearchHistoryItem] })
  list(@CurrentUser() user: AuthUser, @Query() query: ListSearchHistoryQuery) {
    return this.history.list(user.id, query.limit);
  }

  @Post()
  @ApiOperation({ summary: 'Record a completed search query' })
  @ApiCreatedResponse({ type: SearchHistoryItem })
  record(@CurrentUser() user: AuthUser, @Body() dto: RecordSearchDto) {
    return this.history.record(user.id, dto.query);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Clear all my search history' })
  @ApiNoContentResponse()
  async clear(@CurrentUser() user: AuthUser): Promise<void> {
    await this.history.clear(user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete one search history entry' })
  @ApiNoContentResponse()
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.history.remove(user.id, id);
  }
}
