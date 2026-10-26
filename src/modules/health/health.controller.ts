import { Controller, Get } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { DB, type AppDatabase } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { Public } from '../../common/security/decorators';

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(@Inject(DB) private readonly db: AppDatabase) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe with a database round-trip' })
  async check(): Promise<{ status: string; database: string; uptimeSeconds: number; version: string }> {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw AppError.unavailable('database_unavailable', 'The database did not respond to a health check');
    }

    return {
      status: 'ok',
      database: 'up',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      version: process.env.npm_package_version ?? '2.0.0',
    };
  }
}
