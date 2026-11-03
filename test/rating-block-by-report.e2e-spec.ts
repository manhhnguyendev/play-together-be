import { eq } from 'drizzle-orm';
import request from 'supertest';
import { orders } from '../src/db/schema';
import { BackgroundJobs } from '../src/modules/jobs/background-jobs.service';
import { createTestApp, TEST_DEMO_PASSWORD, type TestApp } from './app.helper';

const API = '/api/v2';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

type Auth = { accessToken: string; user: { id: string } };
type OrderResponse = {
  id: string;
  status: string;
  canRate: boolean;
  hasRated: boolean;
  endedAt: string | null;
};

async function login(http: ReturnType<typeof request>, email: string): Promise<Auth> {
  const response = await http
    .post(`${API}/auth/login`)
    .send({ email, password: TEST_DEMO_PASSWORD })
    .expect(200);
  return response.body as Auth;
}

/**
 * A report and a rating are two views of the same complaint, so filing one closes the
 * other for the person who filed it. The POST has always enforced that; the `canRate`
 * flag the order views are built from did not, which left the app rendering a "Đánh giá"
 * button whose every press answered 409. See docs/product-audit.md §40.
 */
describe('Rating blocked by the reporter’s own report (e2e)', () => {
  let harness: TestApp;
  let http: ReturnType<typeof request>;
  let jobs: BackgroundJobs;
  let hirer: Auth;
  let player: Auth;
  let orderId: string;

  const orderAs = async (who: Auth): Promise<OrderResponse> =>
    (
      await http
        .get(`${API}/orders/${orderId}`)
        .set(bearer(who.accessToken))
        .expect(200)
    ).body as OrderResponse;

  beforeAll(async () => {
    harness = await createTestApp();
    await harness.seed();
    http = request(harness.app.getHttpServer());
    jobs = harness.app.get(BackgroundJobs);

    hirer = await login(http, 'demo.hirer1@playtogether.local');
    player = await login(http, 'demo.player1@playtogether.local');

    const games = await http.get(`${API}/games?pageSize=100`).expect(200);
    const arenaOfValorId = games.body.items.find((item: { name: string }) => item.name === 'Arena of Valor').id;

    const created = (
      await http
        .post(`${API}/orders`)
        .set(bearer(hirer.accessToken))
        .send({ playerId: player.user.id, hours: 1, message: 'Ranked session.', gameIds: [arenaOfValorId] })
        .expect(201)
    ).body as OrderResponse;
    orderId = created.id;

    await http.post(`${API}/orders/${orderId}/accept`).set(bearer(player.accessToken)).expect(200);
    await harness.db
      .update(orders)
      .set({ scheduledEndAt: new Date(Date.now() - 60_000) })
      .where(eq(orders.id, orderId));
    // The scheduler stamps endedAt and opens the reconciliation, which is a feedback status.
    await jobs.runOnce();
  });

  afterAll(async () => {
    await harness.app.close();
  });

  it('offers the rating to both parties while nothing has been filed', async () => {
    const asHirer = await orderAs(hirer);
    expect(asHirer.status).toBe('DISPUTED');
    expect(asHirer.endedAt).toBeTruthy();
    expect(asHirer.canRate).toBe(true);

    const asPlayer = await orderAs(player);
    expect(asPlayer.canRate).toBe(true);
  });

  it('takes the offer away from the reporter and names the reason', async () => {
    await http
      .post(`${API}/orders/${orderId}/reports`)
      .set(bearer(hirer.accessToken))
      .send({ message: 'Left the session before the agreed hour.' })
      .expect(201);

    expect((await orderAs(hirer)).canRate).toBe(false);

    const refused = await http
      .post(`${API}/orders/${orderId}/ratings`)
      .set(bearer(hirer.accessToken))
      .send({ rate: 2, comment: 'Should have ended earlier.' })
      .expect(409);
    expect(refused.body.code).toBe('rating_blocked_by_report');
    expect(refused.body.detail).toMatch(/reported/);
  });

  it('does not let one party’s report silence the other', async () => {
    expect((await orderAs(player)).canRate).toBe(true);

    await http
      .post(`${API}/orders/${orderId}/ratings`)
      .set(bearer(player.accessToken))
      .send({ rate: 4, comment: 'Good session overall.' })
      .expect(201);

    const after = await orderAs(player);
    expect(after.hasRated).toBe(true);
    expect(after.canRate).toBe(false);
  });
});
