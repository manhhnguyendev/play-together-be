import { Global, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connectDatabase, DB, DB_CONNECTION, type DatabaseConnection } from '../../db/client';
import type { AppDatabase, DbExecutor } from '../../db/client';

export { DB, DB_CONNECTION };
export type { AppDatabase, DbExecutor, DatabaseConnection };

@Injectable()
export class DatabaseLifecycle implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseLifecycle.name);

  constructor(private readonly connection: DatabaseConnection) {}

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.connection.close();
    } catch (error) {
      this.logger.warn(`Failed to close database cleanly: ${(error as Error).message}`);
    }
  }
}

async function createConnection(config: ConfigService): Promise<DatabaseConnection> {
  const logger = new Logger('Database');
  const driver = config.get<string>('DATABASE_DRIVER') ?? 'pglite';
  const autoMigrate = config.get<boolean>('AUTO_MIGRATE') === true;

  const connection = await connectDatabase({
    driver,
    databaseUrl: config.get<string>('DATABASE_URL'),
    pgliteDir: config.get<string>('PGLITE_DIR'),
    logging: config.get<boolean>('DB_LOGGING') === true,
    migrate: autoMigrate,
  });

  logger.log(`Connected using ${driver}${autoMigrate ? ' (migrated)' : ''}`);
  return connection;
}

@Global()
@Module({
  providers: [
    {
      provide: DB_CONNECTION,
      inject: [ConfigService],
      useFactory: createConnection,
    },
    {
      provide: DB,
      inject: [DB_CONNECTION],
      useFactory: (connection: DatabaseConnection) => connection.db,
    },
    {
      provide: DatabaseLifecycle,
      inject: [DB_CONNECTION],
      useFactory: (connection: DatabaseConnection) => new DatabaseLifecycle(connection),
    },
  ],
  exports: [DB],
})
export class DatabaseModule {}
