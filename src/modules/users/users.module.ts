import { Module } from '@nestjs/common';
import { StatsService } from './stats.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, StatsService],
  exports: [UsersService, StatsService],
})
export class UsersModule {}
