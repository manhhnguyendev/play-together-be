import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CommonModule } from './common/common.module';
import { validateEnv } from './common/config/env';
import { DatabaseModule } from './common/database/database.module';
import { ProblemDetailsFilter } from './common/errors/problem-details.filter';
import { JwtAuthGuard } from './common/security/jwt-auth.guard';
import { RolesGuard } from './common/security/roles.guard';
import { SecurityModule } from './common/security/security.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { BehaviorModule } from './modules/behavior/behavior.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CharityModule } from './modules/charity/charity.module';
import { ChatModule } from './modules/chat/chat.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { HealthModule } from './modules/health/health.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrdersModule } from './modules/orders/orders.module';
import { RatingsModule } from './modules/ratings/ratings.module';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SearchHistoryModule } from './modules/search-history/search-history.module';
import { SystemConfigModule } from './modules/system-config/system-config.module';
import { UsersModule } from './modules/users/users.module';
import { WalletModule } from './modules/wallet/wallet.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'default',
          ttl: (config.get<number>('THROTTLE_TTL') ?? 60) * 1000,
          limit: config.get<number>('THROTTLE_LIMIT') ?? 120,
        },
      ],
    }),
    DatabaseModule,
    CommonModule,
    SecurityModule,
    SystemConfigModule,
    NotificationsModule,
    BehaviorModule,
    UsersModule,
    AuthModule,
    CatalogModule,
    WalletModule,
    OrdersModule,
    RatingsModule,
    ReportsModule,
    CharityModule,
    ChatModule,
    FeedbackModule,
    SearchHistoryModule,
    RecommendationsModule,
    AdminModule,
    JobsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
