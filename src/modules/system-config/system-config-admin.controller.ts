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
  Query,
} from '@nestjs/common';
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
import { AdminRoles, Roles } from '../../common/security/decorators';
import { CreateConfigDto, DeleteConfigDto, ResolvedConfigDto, UpdateConfigDto } from './config.dto';
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
  @AdminRoles('FINANCE')
  @ApiOperation({ summary: 'Create a configuration entry' })
  @ApiCreatedResponse({ type: ResolvedConfigDto })
  create(@CurrentUser() admin: AuthUser, @Body() dto: CreateConfigDto): Promise<ResolvedConfigDto> {
    return this.configs.create(admin, dto);
  }

  @Patch(':id')
  @AdminRoles('FINANCE')
  @ApiOperation({ summary: 'Update a configuration entry' })
  @ApiOkResponse({ type: ResolvedConfigDto })
  update(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConfigDto,
  ): Promise<ResolvedConfigDto> {
    return this.configs.update(admin, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @AdminRoles('FINANCE')
  @ApiOperation({ summary: 'Delete a non-core configuration entry' })
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DeleteConfigDto,
  ): Promise<void> {
    await this.configs.remove(admin, id, query.reason);
  }
}
