import { Global, Module } from '@nestjs/common';
import { SystemConfigAdminController } from './system-config-admin.controller';
import { SystemConfigController } from './system-config.controller';
import { SystemConfigService } from './system-config.service';

@Global()
@Module({
  controllers: [SystemConfigController, SystemConfigAdminController],
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
