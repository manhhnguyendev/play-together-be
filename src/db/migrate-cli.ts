import 'dotenv/config';
import { validateEnv } from '../common/config/env';
import { connectDatabase } from './client';

async function main(): Promise<void> {
  const env = validateEnv(process.env);
  const connection = await connectDatabase({
    driver: String(env.DATABASE_DRIVER),
    pgliteDir: String(env.PGLITE_DIR),
    databaseUrl: typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL : undefined,
    logging: env.DB_LOGGING === true,
    migrate: true,
  });

  try {
    console.log('Migrations applied using %s', env.DATABASE_DRIVER === 'postgres' ? 'DATABASE_URL' : env.PGLITE_DIR);
  } finally {
    await connection.close();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
