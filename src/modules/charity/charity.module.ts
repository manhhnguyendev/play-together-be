import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { CharityAdminController } from './charity-admin.controller';
import { CharityMeController } from './charity-me.controller';
import { CharitiesController } from './charities.controller';
import { CharityService } from './charity.service';

@Module({
  imports: [WalletModule],
  controllers: [CharitiesController, CharityMeController, CharityAdminController],
  providers: [CharityService],
  exports: [CharityService],
})
export class CharityModule {}
