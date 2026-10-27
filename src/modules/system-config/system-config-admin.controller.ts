import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/security/decorators';
import { CreateConfigDto, ResolvedConfigDto, UpdateConfigDto } from './config.dto';
import { SystemConfigService } from './system-config.service';

@ApiTags('admin:configs')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/configs')
export class SystemConfigAdminController {
  constructor(private readonly configs: SystemConfigService) {}

  @Get()
  @ApiOperation({ summary: 'List every configuration entry (defaults included)' })
  @ApiOkResponse({ type: [ResolvedConfigDto] })
  list(): Promise<ResolvedConfigDto[]> {
    return this.configs.listResolved();
  }

  @Post()
  @ApiOperation({ summary: 'Create a configuration entry' })
  @ApiCreatedResponse({ type: ResolvedConfigDto })
  create(@Body() dto: CreateConfigDto): Promise<ResolvedConfigDto> {
    return this.configs.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a configuration entry' })
  @ApiOkResponse({ type: ResolvedConfigDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConfigDto): Promise<ResolvedConfigDto> {
    return this.configs.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a non-core configuration entry' })
  @ApiNoContentResponse()
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.configs.remove(id);
  }
}
