import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { ListSearchHistoryQuery, RecordSearchDto } from './search-history.dto';
import { SearchHistoryService } from './search-history.service';

@ApiTags('search-history')
@ApiBearerAuth()
@Controller('search-history')
export class SearchHistoryController {
  constructor(private readonly history: SearchHistoryService) {}

  @Get()
  @ApiOperation({ summary: 'My recent player searches' })
  list(@CurrentUser() user: AuthUser, @Query() query: ListSearchHistoryQuery) {
    return this.history.list(user.id, query.limit);
  }

  @Post()
  @ApiOperation({ summary: 'Record a completed search query' })
  record(@CurrentUser() user: AuthUser, @Body() dto: RecordSearchDto) {
    return this.history.record(user.id, dto.query);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Clear all my search history' })
  async clear(@CurrentUser() user: AuthUser): Promise<void> {
    await this.history.clear(user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete one search history entry' })
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.history.remove(user.id, id);
  }
}
