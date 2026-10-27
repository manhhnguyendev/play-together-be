import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '../../common/pagination/pagination';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { Roles } from '../../common/security/decorators';
import { ListAdminReportsQuery, ReportDto, ReportPage, ResolveReportDto } from './reports.dto';
import { ReportsService } from './reports.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/reports')
export class ReportsAdminController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @ApiOperation({ summary: 'Moderation queue' })
  @ApiOkResponse({ type: ReportPage })
  list(@Query() query: ListAdminReportsQuery): Promise<Paginated<ReportDto>> {
    return this.reports.adminList(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Report detail for moderators' })
  @ApiOkResponse({ type: ReportDto })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ReportDto> {
    return this.reports.get(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Approve (with penalties) or reject a report' })
  @ApiOkResponse({ type: ReportDto })
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReportDto,
  ): Promise<ReportDto> {
    return this.reports.resolve(user.id, id, dto);
  }
}
