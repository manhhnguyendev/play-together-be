import { and, count, eq } from 'drizzle-orm';
import request from 'supertest';
import {
  escrowHolds,
  ledgerEntries,
  orders,
  pendingCredits,
  users,
} from '../src/db/schema';
import { BackgroundJobs } from '../src/modules/jobs/background-jobs.service';
import { createTestApp, TEST_ADMIN, TEST_DEMO_PASSWORD, type TestApp } from './app.helper';

const API = '/api/v2';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const HOUR = 3_600_000;

type Authenticated = { accessToken: string; user: { id: string } };
type OrderResponse = {
  id: string;
  status: string;
  playerPayout: number | null;
  escrowStatus: string;
  disputedAt: string | null;
  disputeDeadlineAt: string | null;
};

async function login(http: ReturnType<typeof request>, email: string, password: string): Promise<Authenticated> {
  const response = await http.post(`${API}/auth/login`).send({ email, password }).expect(200);
  return response.body as Authenticated;
}

/**
 * What happens when the session clock runs out. Before this, the scheduler paid
 * the player in full the moment `scheduled_end_at` passed, with no confirmation
 * from the hirer whose money was released. See docs/product-audit.md §3.
 */
describe('Payout objection window (e2e)', () => {
  let harness: TestApp;
  let http: ReturnType<typeof request>;
  let jobs: BackgroundJobs;
  let hirer: Authenticated;
  let player: Authenticated;
  let admin: Authenticated;
  let arenaOfValorId: string;

  const runJobs = () => jobs.runOnce();

  const orderRow = async (orderId: string) => {
    const [row] = await harness.db.select().from(orders).where(eq(orders.id, orderId));
    return row;
  };

  /** Rows that would mean money actually moved for this order. */
  const settlementRows = async (orderId: string) => {
    const [entries, credits] = await Promise.all([
      harness.db
        .select({ type: ledgerEntries.type })
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.orderId, orderId), eq(ledgerEntries.type, 'ORDER_EARNING'))),
      harness.db
        .select({ id: pendingCredits.id })
        .from(pendingCredits)
        .where(eq(pendingCredits.orderId, orderId)),
    ]);
    return { earnings: entries.length, credits: credits.length };
  };

  const hire = async (message: string): Promise<OrderResponse> =>
    (
      await http
        .post(`${API}/orders`)
        .set(bearer(hirer.accessToken))
        .send({ playerId: player.user.id, hours: 1, message, gameIds: [arenaOfValorId] })
        .expect(201)
    ).body as OrderResponse;

  /** Runs a session to the moment its clock expires. */
  const sessionThatOverdue = async (message: string): Promise<OrderResponse> => {
    const created = await hire(message);
    await http.post(`${API}/orders/${created.id}/accept`).set(bearer(player.accessToken)).expect(200);
    await harness.db
      .update(orders)
      .set({ scheduledEndAt: new Date(Date.now() - 60_000) })
      .where(eq(orders.id, created.id));
    return created;
  };

  beforeAll(async () => {
    harness = await createTestApp();
    await harness.seed();
    http = request(harness.app.getHttpServer());
    jobs = harness.app.get(BackgroundJobs);

    hirer = await login(http, 'demo.hirer1@playtogether.local', TEST_DEMO_PASSWORD);
    player = await login(http, 'demo.player1@playtogether.local', TEST_DEMO_PASSWORD);
    admin = await login(http, TEST_ADMIN.email, TEST_ADMIN.password);

    const games = await http.get(`${API}/games?pageSize=100`).expect(200);
    arenaOfValorId = games.body.items.find((item: { name: string }) => item.name === 'Arena of Valor').id;
  });

  afterAll(async () => {
    await harness.app.close();
  });

  it('ends the session without moving the money', async () => {
    const created = await sessionThatOverdue('Night session, please.');

    const result = await runJobs();
    expect(result.disputed).toBeGreaterThanOrEqual(1);

    const detail = await http
      .get(`${API}/orders/${created.id}`)
      .set(bearer(hirer.accessToken))
      .expect(200);
    expect(detail.body.status).toBe('DISPUTED');
    expect(detail.body.disputedAt).toBeTruthy();
    expect(detail.body.disputeDeadlineAt).toBeTruthy();
    expect(detail.body.playerPayout).toBeNull();
    expect(detail.body.escrowStatus).toBe('HELD');

    const row = await orderRow(created.id);
    expect(row.endedAt?.getTime()).toBe(row.scheduledEndAt?.getTime());
    await expect(settlementRows(created.id)).resolves.toEqual({ earnings: 0, credits: 0 });

    // The session is over, so the player is not left marked busy forever.
    const [playerRow] = await harness.db.select().from(users).where(eq(users.id, player.user.id));
    expect(playerRow.status).toBe('ONLINE');
  });

  it('does not hold the marketplace while a payout is being reconciled', async () => {
    // Without this, every finished session took a player off the marketplace for
    // the whole objection window, which is a product-breaking regression.
    const second = await hire('Another session next.');
    expect(second.id).toBeTruthy();

    await http.post(`${API}/orders/${second.id}/reject`).set(bearer(player.accessToken)).send({}).expect(200);
  });

  it('lets a participant confirm completion instead of waiting for the window', async () => {
    const created = await sessionThatOverdue('Confirm me early.');
    await runJobs();
    expect((await orderRow(created.id)).status).toBe('DISPUTED');

    const completed = await http
      .post(`${API}/orders/${created.id}/complete`)
      .set(bearer(hirer.accessToken))
      .expect(200);
    expect(completed.body.status).toBe('SETTLED');
    expect(completed.body.playerPayout).toBeGreaterThan(0);
    // Positive control for the cancelled-booking case: a session that really
    // happened is still rateable.
    expect(completed.body.canRate).toBe(true);
    await expect(settlementRows(created.id)).resolves.toMatchObject({ earnings: 1, credits: 1 });
  });

  it('holds the payout while a report is open, then settles it once a moderator decides', async () => {
    const created = await sessionThatOverdue('This one went badly.');
    await runJobs();

    const reported = await http
      .post(`${API}/orders/${created.id}/reports`)
      .set(bearer(hirer.accessToken))
      .send({ message: 'The player left after ten minutes and stopped replying.' })
      .expect(201);

    // The window has closed, but an unresolved objection outranks the clock.
    await harness.db
      .update(orders)
      .set({ disputedAt: new Date(Date.now() - 25 * HOUR) })
      .where(eq(orders.id, created.id));
    await runJobs();

    const held = await http.get(`${API}/orders/${created.id}`).set(bearer(hirer.accessToken)).expect(200);
    expect(held.body.status).toBe('DISPUTED');
    await expect(settlementRows(created.id)).resolves.toEqual({ earnings: 0, credits: 0 });

    await http
      .patch(`${API}/admin/reports/${reported.body.id}`)
      .set(bearer(admin.accessToken))
      .send({ decision: 'REJECTED', note: 'Reviewed: no fault found.' })
      .expect(200);

    await runJobs();
    const settled = await http.get(`${API}/orders/${created.id}`).set(bearer(hirer.accessToken)).expect(200);
    expect(settled.body.status).toBe('SETTLED');
    await expect(settlementRows(created.id)).resolves.toMatchObject({ earnings: 1 });

    const [hold] = await harness.db
      .select()
      .from(escrowHolds)
      .where(eq(escrowHolds.orderId, created.id));
    expect(hold.status).toBe('SETTLED');
  });

  it('counts the objection state as neither an active session nor a completed one', async () => {
    const rows = await harness.db
      .select({ status: orders.status, value: count() })
      .from(orders)
      .groupBy(orders.status);
    const byStatus = Object.fromEntries(rows.map((row) => [row.status, Number(row.value)])) as Record<
      string,
      number
    >;
    expect(byStatus.DISPUTED).toBeGreaterThan(0);

    const stats = await http.get(`${API}/admin/stats`).set(bearer(admin.accessToken)).expect(200);
    expect(stats.body.orders.active).toBe((byStatus.LIVE ?? 0) + (byStatus.SCHEDULED ?? 0));
    expect(stats.body.orders.completed).toBe((byStatus.SETTLED ?? 0) + (byStatus.ENDED_EARLY ?? 0));
  });
});
