import 'dotenv/config';
import { validateEnv } from '../common/config/env';
import { connectDatabase } from './client';
import { seed } from './seed';

function envString(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value : fallback;
}

async function main(): Promise<void> {
  const env = validateEnv(process.env);
  const connection = await connectDatabase({
    driver: String(env.DATABASE_DRIVER),
    pgliteDir: String(env.PGLITE_DIR),
    databaseUrl: typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL : undefined,
    logging: false,
    migrate: true,
  });

  try {
    const summary = await seed(connection.db, {
      adminEmail: envString('SEED_ADMIN_EMAIL', 'admin@playtogether.local'),
      adminPassword: envString('SEED_ADMIN_PASSWORD', 'Admin@12345'),
      charityEmail: envString('SEED_CHARITY_EMAIL', 'charity@playtogether.local'),
      charityPassword: envString('SEED_CHARITY_PASSWORD', 'Charity@12345'),
      demoData: env.SEED_DEMO_DATA === true,
      bcryptRounds: Number(env.BCRYPT_ROUNDS ?? 12),
    });

    console.log('Seed completed:');
    console.table(summary);
    console.log('Admin login:   %s / %s', envString('SEED_ADMIN_EMAIL', 'admin@playtogether.local'), envString('SEED_ADMIN_PASSWORD', 'Admin@12345'));
    console.log('Charity login: %s / %s', envString('SEED_CHARITY_EMAIL', 'charity@playtogether.local'), envString('SEED_CHARITY_PASSWORD', 'Charity@12345'));
    if (summary.demoUsers > 0) {
      console.log('Demo users:    demo.player1@playtogether.local ... demo.player6@playtogether.local / Demo@12345');
    }
  } finally {
    await connection.close();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
