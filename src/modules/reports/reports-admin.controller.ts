import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/security/auth-user';
import { CurrentUser } from '../../common/security/current-user.decorator';
import { Roles } from '../../common/security/decorators';
import { ListAdminReportsQuery, ResolveReportDto } from './reports.dto';
import { ReportsService } from './reports.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/reports')
export class ReportsAdminController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @ApiOperation({ summary: 'Moderation queue' })
  list(@Query() query: ListAdminReportsQuery) {
    return this.reports.adminList(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Report detail for moderators' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.get(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Approve (with penalties) or reject a report' })
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.reports.resolve(user.id, id, dto);
  }
}
