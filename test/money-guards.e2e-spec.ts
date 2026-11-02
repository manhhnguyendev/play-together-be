import { eq } from 'drizzle-orm';
import request from 'supertest';
import { orders } from '../src/db/schema';
import { createTestApp, TEST_ADMIN, TEST_DEMO_PASSWORD, type TestApp } from './app.helper';

const API = '/api/v2';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

type Authenticated = { accessToken: string; user: { id: string } };

async function login(http: ReturnType<typeof request>, email: string, password: string): Promise<Authenticated> {
  const response = await http.post(`${API}/auth/login`).send({ email, password }).expect(200);
  return response.body as Authenticated;
}

/**
 * Guards that sit between an operator's input and money or reputation.
 * Each case here was broken when it was written; see docs/product-audit.md.
 */
describe('Money and reputation guards (e2e)', () => {
  let harness: TestApp;
  let http: ReturnType<typeof request>;
  let hirer: Authenticated;
  let player: Authenticated;
  let admin: Authenticated;
  let arenaOfValorId: string;

  const order: { id: string } = { id: '' };

  beforeAll(async () => {
    harness = await createTestApp();
    await harness.seed();
    http = request(harness.app.getHttpServer());

    hirer = await login(http, 'demo.hirer1@playtogether.local', TEST_DEMO_PASSWORD);
    player = await login(http, 'demo.player1@playtogether.local', TEST_DEMO_PASSWORD);
    admin = await login(http, TEST_ADMIN.email, TEST_ADMIN.password);

    const games = await http.get(`${API}/games?pageSize=100`).expect(200);
    arenaOfValorId = games.body.items.find((item: { name: string }) => item.name === 'Arena of Valor').id;

    const created = await http
      .post(`${API}/orders`)
      .set(bearer(hirer.accessToken))
      .send({
        playerId: player.user.id,
        hours: 1,
        message: 'Ranked session tonight, please.',
        gameIds: [arenaOfValorId],
      })
      .expect(201);
    order.id = created.body.id;

    await http.post(`${API}/orders/${order.id}/accept`).set(bearer(player.accessToken)).expect(200);
    await harness.db
      .update(orders)
      .set({ scheduledEndAt: new Date(Date.now() - 60_000) })
      .where(eq(orders.id, order.id));
    await http.post(`${API}/orders/${order.id}/complete`).set(bearer(player.accessToken)).expect(200);
  });

  afterAll(async () => {
    await harness.app.close();
  });

  it('moves the rating counters for a neutral 3-star rating', async () => {
    // Three stars is the one score with no behaviour delta, and the shared
    // "nothing changed" shortcut used to skip the stats recompute with it, so
    // the rating was stored while the public average stayed empty.
    await http
      .post(`${API}/orders/${order.id}/ratings`)
      .set(bearer(hirer.accessToken))
      .send({ rate: 3, comment: 'Session was fine, nothing remarkable.' })
      .expect(201);

    const summary = await http.get(`${API}/users/${player.user.id}/ratings/summary`).expect(200);
    expect(summary.body).toMatchObject({ userId: player.user.id, average: 3, count: 1 });
    expect(summary.body.distribution['3']).toBe(1);

    const profile = await http.get(`${API}/users/${player.user.id}`).expect(200);
    expect(profile.body).toMatchObject({ ratingCount: 1, rating: 3 });
  });

  it('refuses a platform fee the order table cannot honour', async () => {
    const configs = await http.get(`${API}/admin/configs`).set(bearer(admin.accessToken)).expect(200);
    const fee = configs.body.find((item: { key: string }) => item.key === 'order.platform_fee_bps');
    expect(fee).toBeTruthy();

    // orders.fee_bps carries `between 0 and 5000`; accepting 10000 here would
    // turn every later order insert into a raw constraint failure.
    await http
      .patch(`${API}/admin/configs/${fee.id}`)
      .set(bearer(admin.accessToken))
      .send({ value: 10_000 })
      .expect(422)
      .expect((response) => expect(response.body.code).toBe('validation_failed'));

    await http
      .patch(`${API}/admin/configs/${fee.id}`)
      .set(bearer(admin.accessToken))
      .send({ value: 1_000 })
      .expect(200);
  });

  it('closes a late rejection as an expiry rather than a decline', async () => {
    const second = await http
      .post(`${API}/orders`)
      .set(bearer(hirer.accessToken))
      .send({
        playerId: player.user.id,
        hours: 1,
        message: 'A second session.',
        gameIds: [arenaOfValorId],
      })
      .expect(201);

    // The app counts the window down and posts a rejection when it reaches zero.
    // Trusting that call would apply the decline penalty to a missed request.
    await harness.db
      .update(orders)
      .set({ respondBy: new Date(Date.now() - 1_000) })
      .where(eq(orders.id, second.body.id));

    const rejected = await http
      .post(`${API}/orders/${second.body.id}/reject`)
      .set(bearer(player.accessToken))
      .send({ reason: 'Sorry, cannot take this session.' })
      .expect(200);

    expect(rejected.body.status).toBe('CLOSED');
    // The reason survives the merge, which is the point of it.
    expect(rejected.body.closeReason).toBe('EXPIRED');
  });
});
