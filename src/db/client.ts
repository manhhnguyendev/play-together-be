import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as schema from './schema';

export const DB = Symbol('DATABASE');
export const DB_CONNECTION = Symbol('DATABASE_CONNECTION');

// PGlite and node-postgres expose different query-result HKTs; this alias is
// the documented way to keep one database type across both drivers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AppDatabase = PgDatabase<any, typeof schema>;
/** Accepts either the root database or an open transaction. */
export type DbExecutor = AppDatabase;
export type DatabaseConnection = { db: AppDatabase; close: () => Promise<void> };

export type ConnectOptions = {
  driver: string;
  pgliteDir?: string;
  databaseUrl?: string;
  logging?: boolean;
  migrate?: boolean;
  migrationsFolder?: string;
};

function migrationsFolderOf(override?: string): string {
  return override ?? join(__dirname, 'migrations');
}

export async function connectDatabase(options: ConnectOptions): Promise<DatabaseConnection> {
  const migrationsFolder = migrationsFolderOf(options.migrationsFolder);

  if (options.driver === 'postgres') {
    if (!options.databaseUrl) throw new Error('DATABASE_URL is required when DATABASE_DRIVER=postgres');
    const pool = new Pool({ connectionString: options.databaseUrl, max: 10 });
    const db = drizzlePg(pool, { schema, casing: 'snake_case', logger: options.logging === true });
    if (options.migrate) {
      await migratePg(db, { migrationsFolder });
    }
    return { db: db as unknown as AppDatabase, close: () => pool.end() };
  }

  const dataDir = options.pgliteDir ?? '.data/pgdata';
  if (!dataDir.includes('://')) mkdirSync(dirname(dataDir), { recursive: true });
  const client = new PGlite(dataDir);
  await client.waitReady;
  const db = drizzlePglite(client, { schema, casing: 'snake_case', logger: options.logging === true });
  if (options.migrate) {
    await migratePglite(db, { migrationsFolder });
  }
  return { db: db as unknown as AppDatabase, close: () => client.close() };
}
