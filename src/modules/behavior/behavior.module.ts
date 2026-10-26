import { Global, Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { BehaviorController } from './behavior.controller';
import { BehaviorService } from './behavior.service';

@Global()
@Module({
  imports: [UsersModule],
  controllers: [BehaviorController],
  providers: [BehaviorService],
  exports: [BehaviorService],
})
export class BehaviorModule {}
