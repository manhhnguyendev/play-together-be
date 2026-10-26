import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { WalletModule } from '../wallet/wallet.module';
import { BackgroundJobs } from './background-jobs.service';

@Module({
  imports: [OrdersModule, WalletModule],
  providers: [BackgroundJobs],
  exports: [BackgroundJobs],
})
export class JobsModule {}
