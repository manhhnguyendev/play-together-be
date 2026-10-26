import { Module } from '@nestjs/common';
import { BehaviorModule } from '../behavior/behavior.module';
import { OrdersModule } from '../orders/orders.module';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { ReportsAdminController } from './reports-admin.controller';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [UsersModule, BehaviorModule, OrdersModule, WalletModule],
  controllers: [ReportsController, ReportsAdminController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
