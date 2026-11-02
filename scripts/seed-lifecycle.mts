/**
 * Dev-only helper: drives the new lifecycle over real HTTP so the mobile screens
 * can be looked at. Run with `npx tsx scripts/seed-lifecycle.mts <phase>`.
 *
 *   phase 1  instant hire -> LIVE                (API must be up)
 *   phase 2  booked slot -> SCHEDULED            (API must be up, after phase 1 settled)
 *
 * Between the two phases `scheduled_end_at` of the LIVE order is moved into the
 * past with --rewind, which needs the API stopped because PGlite is single-writer.
 */
import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';

const API = process.env.SEED_API_URL ?? 'http://localhost:3000/api/v2';
const PASSWORD = 'Demo@12345';
const HIRER = 'demo.hirer1@playtogether.local';
const PLAYER = 'demo.player1@playtogether.local';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const STATE_FILE = new URL('./seed-lifecycle.state.json', import.meta.url);

type Token = { accessToken: string; user: { id: string } };

async function login(email: string): Promise<Token> {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`login ${email} failed: HTTP ${response.status}`);
  return (await response.json()) as Token;
}

async function call<T>(token: Token, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    method: init?.method ?? (init?.body ? 'POST' : 'GET'),
    headers: {
      authorization: `Bearer ${token.accessToken}`,
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> HTTP ${response.status} ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

async function ensureBalance(token: Token, amount: number): Promise<void> {
  const wallet = await call<{ availableBalance: number }>(token, '/wallet');
  if (wallet.availableBalance >= amount) {
    console.log(`balance ok: ${wallet.availableBalance}`);
    return;
  }
  const needed = Math.min(5_000_000, Math.max(100_000, Math.ceil((amount - wallet.availableBalance) / 1000) * 1000));
  const deposit = await call<{ id: string }>(token, '/wallet/deposits', {
    body: JSON.stringify({ amount: needed }),
  });
  await call(token, `/wallet/deposits/${deposit.id}/confirm`, { body: '{}' });
  const after = await call<{ availableBalance: number }>(token, '/wallet');
  console.log(`topped up ${needed} -> balance ${after.availableBalance}`);
}

/** The earliest hour-long slot inside the player's published hours, >= 20 min ahead. */
async function earliestSlot(playerId: string, hours: number): Promise<string> {
  const windows = (await (await fetch(`${API}/users/${playerId}/availability`)).json()) as Array<{
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
  }>;
  if (windows.length === 0) throw new Error('the demo player publishes no hours');

  const earliest = Date.now() + 20 * MINUTE;
  for (let ahead = 0; ahead <= 8; ahead += 1) {
    const probe = new Date(earliest + ahead * 24 * HOUR);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(probe);
    const read = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
    const dayNumber: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const dayOfWeek = dayNumber[read('weekday')] ?? 1;
    const localMidnight =
      Date.UTC(Number(read('year')), Number(read('month')) - 1, Number(read('day'))) - 7 * HOUR;

    for (const window of windows.filter((item) => item.dayOfWeek === dayOfWeek)) {
      for (let minute = window.startMinute; minute + hours * 60 <= window.endMinute; minute += 30) {
        const start = localMidnight + minute * MINUTE;
        if (start < earliest) continue;
        return new Date(start).toISOString();
      }
    }
  }
  throw new Error('no slot at least 20 minutes ahead inside the published hours');
}

type State = { liveOrderId?: string; bookedOrderId?: string };
const readState = async (): Promise<State> => {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8')) as State;
  } catch {
    return {};
  }
};
const writeState = async (state: State): Promise<void> => {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
};

const phase = process.argv[2] ?? '1';
const hirer = await login(HIRER);
const player = await login(PLAYER);

const games = (await (await fetch(`${API}/games?pageSize=100`)).json()) as {
  items: Array<{ id: string; name: string }>;
};
const gameId = games.items.find((item) => item.name === 'Arena of Valor')?.id;
if (!gameId) throw new Error('Arena of Valor is not in the catalog');

const playerProfile = (await (await fetch(`${API}/users/${player.user.id}`)).json()) as {
  pricePerHour: number;
};

if (phase === '1') {
  const cost = playerProfile.pricePerHour * 2;
  await ensureBalance(hirer, cost);

  const created = await call<{ id: string; status: string }>(hirer, '/orders', {
    body: JSON.stringify({
      playerId: player.user.id,
      hours: 2,
      message: 'Demo: phiên đang chạy để xem màn đối soát.',
      gameIds: [gameId],
    }),
  });
  const accepted = await call<{ id: string; status: string; scheduledEndAt: string }>(
    player,
    `/orders/${created.id}/accept`,
    { body: '{}' },
  );
  console.log(`LIVE order ${accepted.id} status=${accepted.status} ends ${accepted.scheduledEndAt}`);
  await writeState({ ...(await readState()), liveOrderId: accepted.id });
  console.log('now: stop the API, run `npx tsx scripts/seed-lifecycle.mts rewind`, start it again');
}

if (phase === 'rewind') {
  const state = await readState();
  if (!state.liveOrderId) throw new Error('run phase 1 first');
  const { sql } = await import('drizzle-orm');
  const { connectDatabase } = await import('../src/db/client');
  const db = await connectDatabase({
    driver: 'pglite',
    pgliteDir: process.env.PGLITE_DIR ?? '.data/pgdata',
    logging: false,
  });
  const end = new Date(Date.now() - 2 * MINUTE);
  const start = new Date(end.getTime() - 2 * HOUR);
  await db.execute(
    sql`update orders set starts_at = ${start}, scheduled_end_at = ${end} where id = ${state.liveOrderId}::uuid`,
  );
  console.log(`rewound ${state.liveOrderId}: started ${start.toISOString()} ended ${end.toISOString()}`);
  await db.close();
  console.log('now: start the API again and wait ~35s for the scheduler to open the dispute window');
}

if (phase === '2') {
  const startsAt = await earliestSlot(player.user.id, 1);
  const created = await call<{ id: string; status: string; startsAt: string }>(hirer, '/orders', {
    body: JSON.stringify({
      playerId: player.user.id,
      hours: 1,
      message: 'Demo: lịch hẹn đã được giữ.',
      gameIds: [gameId],
      startsAt,
    }),
  });
  const accepted = await call<{ id: string; status: string; escrowStatus: string }>(
    player,
    `/orders/${created.id}/accept`,
    { body: '{}' },
  );
  console.log(`BOOKED order ${accepted.id} status=${accepted.status} starts=${created.startsAt} escrow=${accepted.escrowStatus}`);
  await writeState({ ...(await readState()), bookedOrderId: accepted.id });
}
