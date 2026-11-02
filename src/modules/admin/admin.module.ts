import { Module } from '@nestjs/common';
import { BehaviorModule } from '../behavior/behavior.module';
import { OrdersModule } from '../orders/orders.module';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminOpsController } from './admin-ops.controller';
import { AdminOpsService } from './admin-ops.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [UsersModule, OrdersModule, WalletModule, BehaviorModule],
  controllers: [AdminController, AdminOpsController],
  providers: [AdminService, AdminOpsService],
  exports: [AdminService],
})
export class AdminModule {}
