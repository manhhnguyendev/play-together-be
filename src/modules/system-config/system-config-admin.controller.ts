import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/security/decorators';
import { CreateConfigDto, UpdateConfigDto } from './config.dto';
import { SystemConfigService } from './system-config.service';

@ApiTags('admin:configs')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/configs')
export class SystemConfigAdminController {
  constructor(private readonly configs: SystemConfigService) {}

  @Get()
  @ApiOperation({ summary: 'List every configuration entry (defaults included)' })
  list() {
    return this.configs.listResolved();
  }

  @Post()
  @ApiOperation({ summary: 'Create a configuration entry' })
  create(@Body() dto: CreateConfigDto) {
    return this.configs.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a configuration entry' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConfigDto) {
    return this.configs.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a non-core configuration entry' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.configs.remove(id);
  }
}
