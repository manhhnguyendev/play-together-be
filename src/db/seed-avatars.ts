import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, isNull, or, asc, eq, inArray } from 'drizzle-orm';
import { validateEnv } from '../common/config/env';
import { connectDatabase } from './client';
import { charities, users } from './schema';

/**
 * Gives every record that has no picture a real one, so the marketplace does not open on a wall of
 * initials.
 *
 * The files live in `uploads/seed/` — the same directory user uploads land in and the same URL prefix
 * the API serves — which is why the stored value is a root-relative path exactly like a photo someone
 * uploaded from the app.
 *
 * Rows are picked when they have no picture, or when their picture is one of this script's own seed
 * files (an earlier run may have ignored gender). A Google provider photo and anything someone
 * uploaded from the app are never touched, so this is safe to re-run after every fresh seed.
 *
 * Usage: npm run db:avatars   (the API must be stopped first — PGlite is a single-writer engine)
 */

const MALE_POOL = [2, 4, 6, 8].map((n) => `/uploads/seed/avatar-0${n}.jpg`);
const FEMALE_POOL = [1, 3, 5, 7].map((n) => `/uploads/seed/avatar-0${n}.jpg`);
const OTHER_POOL = [8, 7].map((n) => `/uploads/seed/avatar-0${n}.jpg`);
const PEOPLE_POOL = [...FEMALE_POOL, ...MALE_POOL];
const ORG_POOL = ['/uploads/seed/charity-01.jpg', '/uploads/seed/charity-02.jpg'];
const HEALTH_URL = process.env.SELF_CHECK_URL ?? 'http://127.0.0.1:3000/api/v2/health';

function assertFilesExist(pool: string[]): void {
  const missing = pool.filter((url) => !existsSync(resolve(process.cwd(), 'uploads', url.slice('/uploads/'.length))));
  if (missing.length > 0) {
    throw new Error(`Seed avatars are missing from uploads/seed: ${missing.join(', ')}`);
  }
}

async function refuseIfApiIsRunning(): Promise<void> {
  try {
    // Any answer at all — 200 or 503 — means a process holds the data directory.
    await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
    throw new Error(
      `The API is answering on ${HEALTH_URL}. Stop it before writing: PGlite allows one writer per data directory.`,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('The API is answering')) throw error;
  }
}

async function main(): Promise<void> {
  await refuseIfApiIsRunning();
  assertFilesExist([...PEOPLE_POOL, ...ORG_POOL]);

  const env = validateEnv(process.env);
  const connection = await connectDatabase({
    driver: String(env.DATABASE_DRIVER),
    pgliteDir: String(env.PGLITE_DIR),
    databaseUrl: typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL : undefined,
    logging: false,
    migrate: true,
  });

  try {
    const db = connection.db;

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        gender: users.gender,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(
        or(
          isNull(users.avatarUrl),
          // A previous run picked without looking at gender; those rows are still ours to fix.
          inArray(users.avatarUrl, PEOPLE_POOL),
        ),
      )
      .orderBy(asc(users.createdAt), asc(users.id));

    const seenPerGender = new Map<string, number>();
    let assigned = 0;
    for (const row of rows) {
      const pool =
        row.gender === 'MALE' ? MALE_POOL : row.gender === 'FEMALE' ? FEMALE_POOL : OTHER_POOL;
      const index = seenPerGender.get(row.gender) ?? 0;
      seenPerGender.set(row.gender, index + 1);
      await db
        .update(users)
        .set({ avatarUrl: pool[index % pool.length] })
        .where(eq(users.id, row.id));
      assigned += 1;
    }

    const orgs = await db
      .select({ id: charities.id, organizationName: charities.organizationName })
      .from(charities)
      .where(or(isNull(charities.avatarUrl), eq(charities.avatarUrl, '')))
      .orderBy(asc(charities.createdAt), asc(charities.id));

    for (const [index, org] of orgs.entries()) {
      await db
        .update(charities)
        .set({ avatarUrl: ORG_POOL[index % ORG_POOL.length] })
        .where(eq(charities.id, org.id));
    }

    const stillEmpty = await db
      .select({ id: users.id })
      .from(users)
      .where(and(isNull(users.avatarUrl)));

    console.log(`Avatars set for ${assigned} user(s) and ${orgs.length} charity/charities.`);
    console.log(`Users still without a picture: ${stillEmpty.length}`);
    console.log(`By gender: ${[...seenPerGender].map(([gender, count]) => `${gender}=${count}`).join(', ')}`);
  } finally {
    await connection.close();
  }
}

main().catch((error: unknown) => {
  console.error('Avatar seeding failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
