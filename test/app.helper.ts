import './env';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { DB } from '../src/common/database/database.module';
import { serveUploadsFrom, uploadRoot } from '../src/common/storage/serve-uploads';
import type { AppDatabase } from '../src/db/client';
import { seed, type SeedOptions, type SeedSummary } from '../src/db/seed';

export type TestApp = {
  app: INestApplication;
  db: AppDatabase;
  seed: (options?: Partial<SeedOptions>) => Promise<SeedSummary>;
};

export const TEST_ADMIN = { email: 'admin@playtogether.local', password: 'Admin@12345' };
export const TEST_CHARITY = { email: 'charity@playtogether.local', password: 'Charity@12345' };
export const TEST_DEMO_PASSWORD = 'Demo@12345';

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });

  app.setGlobalPrefix('api/v2');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      forbidUnknownValues: true,
    }),
  );
  // Same wiring as bootstrap(), and for the same reason: it has to be in front of the router.
  serveUploadsFrom(app, uploadRoot(process.env.UPLOAD_DIR));
  await app.init();

  const db = app.get<AppDatabase>(DB);
  const seedWith = (options: Partial<SeedOptions> = {}) =>
    seed(db, {
      adminEmail: TEST_ADMIN.email,
      adminPassword: TEST_ADMIN.password,
      charityEmail: TEST_CHARITY.email,
      charityPassword: TEST_CHARITY.password,
      demoData: true,
      bcryptRounds: 4,
      ...options,
    });

  return { app, db, seed: seedWith };
}
