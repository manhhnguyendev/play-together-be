import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenService } from '../../common/security/token.service';
import { OrdersService } from '../orders/orders.service';
import { WalletService } from '../wallet/wallet.service';

/**
 * Lightweight in-process scheduler. It replaces the original hangfire-style
 * background work with a single idempotent tick that can also be triggered
 * from tests through runOnce().
 */
@Injectable()
export class BackgroundJobs implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BackgroundJobs.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly orders: OrdersService,
    private readonly wallet: WalletService,
    private readonly tokens: TokenService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<boolean>('JOBS_ENABLED') !== true) {
      this.logger.log('Background jobs are disabled');
      return;
    }

    const intervalMs = this.config.get<number>('JOBS_INTERVAL_MS') ?? 30_000;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
    this.logger.log(`Background jobs scheduled every ${intervalMs}ms`);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<{ expired: number; completed: number; released: number }> {
    const expired = await this.orders.expireDue();
    const completed = await this.orders.autoCompleteDue();
    const released = await this.wallet.releaseDuePendingCredits();
    await this.tokens.purgeExpired();
    return { expired, completed, released };
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.runOnce();
      if (result.expired || result.completed || result.released) {
        this.logger.log(
          `jobs: expired=${result.expired} completed=${result.completed} released=${result.released}`,
        );
      }
    } catch (error) {
      this.logger.error(`Background job tick failed: ${(error as Error).message}`, (error as Error).stack);
    } finally {
      this.running = false;
    }
  }
}
