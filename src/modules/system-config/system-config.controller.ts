import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/security/decorators';
import { PublicConfigDto } from './config.dto';
import { SystemConfigService } from './system-config.service';

@ApiTags('configs')
@Controller('configs')
export class SystemConfigController {
  constructor(private readonly configs: SystemConfigService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Public, client-safe configuration values' })
  @ApiOkResponse({ type: PublicConfigDto })
  async publicConfigs(): Promise<PublicConfigDto> {
    return this.configs.publicView();
  }
}
