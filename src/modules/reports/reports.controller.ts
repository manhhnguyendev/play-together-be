import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { CreateReportDto, ListReportsQuery, ReportDto, ReportPage } from './reports.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('orders/:id/reports')
  @ApiOperation({ summary: 'Report the other party of a finished order' })
  @ApiCreatedResponse({ type: ReportDto })
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateReportDto,
  ) {
    return this.reports.create(user.id, orderId, dto.message);
  }

  @Get('reports/mine')
  @ApiOperation({ summary: 'Reports I submitted or received' })
  @ApiOkResponse({ type: ReportPage })
  mine(@CurrentUser() user: AuthUser, @Query() query: ListReportsQuery) {
    return this.reports.listMine(user.id, query);
  }

  @Get('reports/:id')
  @ApiOperation({ summary: 'Report detail' })
  @ApiOkResponse({ type: ReportDto })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.get(id, user);
  }
}
