import { Module } from '@nestjs/common';
import { BehaviorModule } from '../behavior/behavior.module';
import { UsersModule } from '../users/users.module';
import { RatingsAdminController } from './ratings-admin.controller';
import { RatingsController } from './ratings.controller';
import { RatingsService } from './ratings.service';

@Module({
  imports: [UsersModule, BehaviorModule],
  controllers: [RatingsController, RatingsAdminController],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
