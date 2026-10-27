export type NodeEnv = 'development' | 'test' | 'production';

const REQUIRED_IN_PRODUCTION = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

export function validateEnv(raw: Record<string, unknown>): Record<string, unknown> {
  const env = { ...raw };
  const nodeEnv = (env.NODE_ENV as NodeEnv) ?? 'development';
  env.NODE_ENV = nodeEnv;

  env.PORT = toInt(env.PORT, 3000);
  env.API_PREFIX = env.API_PREFIX ?? 'api/v2';
  env.APP_TIMEZONE = env.APP_TIMEZONE ?? 'Asia/Ho_Chi_Minh';
  env.CORS_ORIGINS = env.CORS_ORIGINS ?? '*';

  env.DATABASE_DRIVER = env.DATABASE_DRIVER ?? 'pglite';
  if (!['pglite', 'postgres'].includes(String(env.DATABASE_DRIVER))) {
    throw new Error('DATABASE_DRIVER must be "pglite" or "postgres"');
  }
  env.PGLITE_DIR = env.PGLITE_DIR ?? '.data/pgdata';
  env.AUTO_MIGRATE = toBool(env.AUTO_MIGRATE, nodeEnv !== 'production');
  env.DB_LOGGING = toBool(env.DB_LOGGING, false);

  env.JWT_ACCESS_TTL = toInt(env.JWT_ACCESS_TTL, 900);
  env.JWT_REFRESH_TTL = toInt(env.JWT_REFRESH_TTL, 2_592_000);
  env.BCRYPT_ROUNDS = toInt(env.BCRYPT_ROUNDS, 12);
  env.THROTTLE_TTL = toInt(env.THROTTLE_TTL, 60);
  env.THROTTLE_LIMIT = toInt(env.THROTTLE_LIMIT, 120);

  env.JOBS_ENABLED = toBool(env.JOBS_ENABLED, nodeEnv !== 'test');
  env.JOBS_INTERVAL_MS = toInt(env.JOBS_INTERVAL_MS, 30_000);
  env.EXPOSE_RESET_TOKEN = toBool(env.EXPOSE_RESET_TOKEN, nodeEnv !== 'production');
  env.SEED_DEMO_DATA = toBool(env.SEED_DEMO_DATA, false);

  const accessSecret = String(env.JWT_ACCESS_SECRET ?? '');
  const refreshSecret = String(env.JWT_REFRESH_SECRET ?? '');
  if (nodeEnv === 'production') {
    if (env.DATABASE_DRIVER === 'postgres' && !env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required when DATABASE_DRIVER=postgres');
    }
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (!env[key]) throw new Error(`Missing required environment variable ${key}`);
    }
    if (accessSecret.length < 32 || refreshSecret.length < 32) {
      throw new Error('JWT secrets must be at least 32 characters in production');
    }
  } else {
    env.JWT_ACCESS_SECRET = accessSecret || 'dev-access-secret-dev-access-secret-1234';
    env.JWT_REFRESH_SECRET = refreshSecret || 'dev-refresh-secret-dev-refresh-secret-12';
  }

  return env;
}

function toInt(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid integer environment value: ${String(value)}`);
  return parsed;
}

function toBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid boolean environment value: ${String(value)}`);
}
