import { eq } from 'drizzle-orm';
import request from 'supertest';
import { orders } from '../src/db/schema';
import { createTestApp, TEST_ADMIN, TEST_DEMO_PASSWORD, type TestApp } from './app.helper';

const API = '/api/v2';

type LoginResult = { accessToken: string; refreshToken: string; user: { id: string; name: string } };

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(http: ReturnType<typeof request>, email: string, password: string): Promise<LoginResult> {
  const response = await http.post(`${API}/auth/login`).send({ email, password }).expect(200);
  return response.body as LoginResult;
}

describe('Marketplace order lifecycle (e2e)', () => {
  let harness: TestApp;
  let http: ReturnType<typeof request>;

  let hirer: LoginResult;
  let player: LoginResult;
  let player2: LoginResult;
  let admin: LoginResult;

  let arenaOfValorId: string;
  let pubgMobileId: string;

  const firstOrder: { id: string; hours: number; totalPrice: number } = { id: '', hours: 1, totalPrice: 80_000 };
  let hirerBalanceBefore = 0;

  const secondOrder: { id: string } = { id: '' };
  let hirerBalanceBeforeRefund = 0;
  let reportId = '';

  beforeAll(async () => {
    harness = await createTestApp();
    await harness.seed();
    http = request(harness.app.getHttpServer());

    hirer = await login(http, 'demo.hirer1@playtogether.local', TEST_DEMO_PASSWORD);
    player = await login(http, 'demo.player1@playtogether.local', TEST_DEMO_PASSWORD);
    player2 = await login(http, 'demo.player2@playtogether.local', TEST_DEMO_PASSWORD);
    admin = await login(http, TEST_ADMIN.email, TEST_ADMIN.password);

    const games = await http.get(`${API}/games?pageSize=100`).expect(200);
    const byName = (name: string): string => {
      const game = games.body.items.find((item: { name: string }) => item.name === name);
      if (!game) throw new Error(`Seed game not found: ${name}`);
      return game.id;
    };
    arenaOfValorId = byName('Arena of Valor');
    pubgMobileId = byName('PUBG Mobile');

    const wallet = await http.get(`${API}/wallet`).set(bearer(hirer.accessToken)).expect(200);
    hirerBalanceBefore = wallet.body.availableBalance;
  });

  afterAll(async () => {
    await harness.app.close();
  });

  it('creates a hire request for a skilled player', async () => {
    const response = await http
      .post(`${API}/orders`)
      .set(bearer(hirer.accessToken))
      .send({
        playerId: player.user.id,
        hours: 1,
        message: 'Please help me climb ranked tonight.',
        gameIds: [arenaOfValorId],
      })
      .expect(201);

    expect(response.body).toMatchObject({
      status: 'PROCESSING',
      hours: 1,
      hourlyRate: 80_000,
      totalPrice: 80_000,
      escrowStatus: 'NONE',
    });
    firstOrder.id = response.body.id;
  });

  it('moves the full price into escrow when the player accepts', async () => {
    const response = await http
      .post(`${API}/orders/${firstOrder.id}/accept`)
      .set(bearer(player.accessToken))
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ACCEPTED',
      escrowStatus: 'HELD',
      playerPayout: null,
    });
    expect(response.body.startsAt).toEqual(expect.any(String));
    expect(response.body.scheduledEndAt).toEqual(expect.any(String));

    const wallet = await http.get(`${API}/wallet`).set(bearer(hirer.accessToken)).expect(200);
    expect(wallet.body.availableBalance).toBe(hirerBalanceBefore - firstOrder.totalPrice);
  });

  it('settles the escrow, pays the player minus the platform fee and brings the player back online', async () => {
    await harness.db
      .update(orders)
      .set({ scheduledEndAt: new Date(Date.now() - 60_000) })
      .where(eq(orders.id, firstOrder.id));

    const response = await http
      .post(`${API}/orders/${firstOrder.id}/complete`)
      .set(bearer(player.accessToken))
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'COMPLETED',
      escrowStatus: 'SETTLED',
      playerPayout: 72_000,
      feeBps: 1000,
    });

    const wallet = await http.get(`${API}/wallet`).set(bearer(player.accessToken)).expect(200);
    expect(wallet.body.pendingBalance).toBe(72_000);
    expect(wallet.body.pendingCredits).toHaveLength(1);
    expect(wallet.body.pendingCredits[0].amount).toBe(72_000);

    const me = await http.get(`${API}/users/me`).set(bearer(player.accessToken)).expect(200);
    expect(me.body.status).toBe('ONLINE');
  });

  it('accepts one rating per rater and updates the public summary', async () => {
    const rating = await http
      .post(`${API}/orders/${firstOrder.id}/ratings`)
      .set(bearer(hirer.accessToken))
      .send({ rate: 5, comment: 'Friendly and very skilled.' })
      .expect(201);

    expect(rating.body).toMatchObject({ rate: 5, isActive: true, violationStatus: 'NONE' });

    const summary = await http.get(`${API}/users/${player.user.id}/ratings/summary`).expect(200);
    expect(summary.body).toMatchObject({ userId: player.user.id, average: 5, count: 1 });
    expect(summary.body.distribution['5']).toBe(1);

    await http
      .post(`${API}/orders/${firstOrder.id}/ratings`)
      .set(bearer(hirer.accessToken))
      .send({ rate: 4 })
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('already_rated'));
  });

  it('blocks a report from the same party that already rated the order', async () => {
    await http
      .post(`${API}/orders/${firstOrder.id}/reports`)
      .set(bearer(hirer.accessToken))
      .send({ message: 'Trying to report after rating.' })
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('conflict'));
  });

  it('refuses another order while the player is busy with an accepted session', async () => {
    const second = await http
      .post(`${API}/orders`)
      .set(bearer(hirer.accessToken))
      .send({ playerId: player2.user.id, hours: 1, message: 'PUBG coaching', gameIds: [pubgMobileId] })
      .expect(201);
    secondOrder.id = second.body.id;

    await http
      .post(`${API}/orders/${secondOrder.id}/accept`)
      .set(bearer(player2.accessToken))
      .expect(200);

    await http
      .post(`${API}/orders`)
      .set(bearer(hirer.accessToken))
      .send({ playerId: player2.user.id, hours: 1, message: 'Another session', gameIds: [pubgMobileId] })
      .expect(400)
      .expect((response) => expect(response.body.code).toBe('player_unavailable'));

    await harness.db
      .update(orders)
      .set({ scheduledEndAt: new Date(Date.now() - 60_000) })
      .where(eq(orders.id, secondOrder.id));

    const completed = await http
      .post(`${API}/orders/${secondOrder.id}/complete`)
      .set(bearer(player2.accessToken))
      .expect(200);
    expect(completed.body.playerPayout).toBe(54_000);
  });

  it('lets a moderator uphold a report, penalise behavior, refund the hirer and lock the account', async () => {
    const report = await http
      .post(`${API}/orders/${secondOrder.id}/reports`)
      .set(bearer(hirer.accessToken))
      .send({ message: 'The player went offline in the middle of the paid session.' })
      .expect(201);
    reportId = report.body.id;
    expect(report.body.status).toBe('PENDING');

    await http
      .patch(`${API}/admin/reports/${reportId}`)
      .set(bearer(hirer.accessToken))
      .send({ decision: 'APPROVED' })
      .expect(403);

    const queue = await http
      .get(`${API}/admin/reports?status=PENDING&pageSize=50`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(queue.body.items.map((item: { id: string }) => item.id)).toContain(reportId);

    const wallet = await http.get(`${API}/wallet`).set(bearer(hirer.accessToken)).expect(200);
    hirerBalanceBeforeRefund = wallet.body.availableBalance;

    const resolved = await http
      .patch(`${API}/admin/reports/${reportId}`)
      .set(bearer(admin.accessToken))
      .send({
        decision: 'APPROVED',
        note: 'Verified against session logs.',
        points: 10,
        satisfaction: 5,
        disableAccount: true,
        refundAmount: 54_000,
      })
      .expect(200);
    expect(resolved.body.status).toBe('APPROVED');

    const refundedWallet = await http.get(`${API}/wallet`).set(bearer(hirer.accessToken)).expect(200);
    expect(refundedWallet.body.availableBalance).toBe(hirerBalanceBeforeRefund + 54_000);

    const behavior = await http.get(`${API}/users/${player2.user.id}/behavior`).expect(200);
    expect(behavior.body).toMatchObject({ points: 90, satisfaction: 95 });

    await http
      .post(`${API}/auth/login`)
      .send({ email: 'demo.player2@playtogether.local', password: TEST_DEMO_PASSWORD })
      .expect(403)
      .expect((response) => expect(response.body.code).toBe('account_disabled'));

    await http
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: player2.refreshToken })
      .expect(401)
      .expect((response) => expect(response.body.code).toBe('invalid_refresh_token'));
  });
});
