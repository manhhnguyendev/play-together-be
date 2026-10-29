import request from 'supertest';
import { createTestApp, TEST_ADMIN, TEST_DEMO_PASSWORD, type TestApp } from './app.helper';

const API = '/api/v2';

type LoginResult = { accessToken: string; user: { id: string; name: string } };

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(http: ReturnType<typeof request>, email: string, password: string): Promise<LoginResult> {
  const response = await http.post(`${API}/auth/login`).send({ email, password }).expect(200);
  return response.body as LoginResult;
}

describe('v2 capability gaps (e2e)', () => {
  let harness: TestApp;
  let http: ReturnType<typeof request>;

  let player1: LoginResult;
  let hirer1: LoginResult;
  let admin: LoginResult;
  let gameId = '';

  beforeAll(async () => {
    harness = await createTestApp();
    await harness.seed();
    http = request(harness.app.getHttpServer());

    player1 = await login(http, 'demo.player1@playtogether.local', TEST_DEMO_PASSWORD);
    hirer1 = await login(http, 'demo.hirer1@playtogether.local', TEST_DEMO_PASSWORD);
    admin = await login(http, TEST_ADMIN.email, TEST_ADMIN.password);

    const profile = await http.get(`${API}/users/${player1.user.id}`).expect(200);
    gameId = profile.body.skills[0]?.game?.id;
    if (!gameId) {
      const games = await http.get(`${API}/games?pageSize=1`).expect(200);
      gameId = games.body.items[0].id;
    }
  });

  afterAll(async () => {
    await harness.app.close();
  });

  it('filters players by gender and initial letter', async () => {
    const response = await http.get(`${API}/users?genders=MALE&initial=T&sort=name`).expect(200);

    expect(response.body.items.length).toBeGreaterThan(0);
    for (const item of response.body.items) {
      expect(item.gender).toBe('MALE');
      expect(item.name.toLowerCase().startsWith('t')).toBe(true);
    }

    await http.get(`${API}/users?initial=AB`).expect(400);
    await http.get(`${API}/users?genders=UNKNOWN`).expect(400);
  });

  it('aggregates trending searches without exposing who searched', async () => {
    await http
      .post(`${API}/search-history`)
      .set(bearer(player1.accessToken))
      .send({ query: 'Liên Quân' })
      .expect(201);
    await http
      .post(`${API}/search-history`)
      .set(bearer(hirer1.accessToken))
      .send({ query: 'liên quân' })
      .expect(201);
    await http
      .post(`${API}/search-history`)
      .set(bearer(player1.accessToken))
      .send({ query: 'valorant' })
      .expect(201);

    const response = await http.get(`${API}/search-history/hot?limit=5`).expect(200);

    expect(response.body[0]).toEqual({ query: expect.stringMatching(/liên quân/i), searches: 2 });
    expect(JSON.stringify(response.body)).not.toContain(player1.user.id);
  });

  it('keeps a favorite list and ranks games by favorite count', async () => {
    const before = await http.get(`${API}/users/me/favorites`).set(bearer(player1.accessToken)).expect(200);
    const seededIds: string[] = before.body.map((item: { id: string }) => item.id);

    const games = await http.get(`${API}/games?pageSize=100`).expect(200);
    const popularBefore = await http.get(`${API}/games/most-favorited?limit=20`).expect(200);
    const countOf = (id: string): number =>
      popularBefore.body.find((item: { id: string }) => item.id === id)?.favoriteCount ?? 0;

    const fresh = games.body.items.find((item: { id: string }) => !seededIds.includes(item.id));
    if (!fresh) throw new Error('Every seeded game is already a favorite');
    const favoritesBefore = countOf(fresh.id);

    await http
      .post(`${API}/users/me/favorites`)
      .set(bearer(player1.accessToken))
      .send({ gameId: fresh.id })
      .expect(204);
    await http
      .post(`${API}/users/me/favorites`)
      .set(bearer(player1.accessToken))
      .send({ gameId: fresh.id })
      .expect(204);

    const mine = await http.get(`${API}/users/me/favorites`).set(bearer(player1.accessToken)).expect(200);
    expect(mine.body).toHaveLength(seededIds.length + 1);
    expect(mine.body.filter((item: { id: string }) => item.id === fresh.id)).toHaveLength(1);

    const popular = await http.get(`${API}/games/most-favorited?limit=20`).expect(200);
    const ranked = popular.body.find((item: { id: string }) => item.id === fresh.id);
    expect(ranked.favoriteCount).toBe(favoritesBefore + 1);

    await http
      .delete(`${API}/users/me/favorites/${fresh.id}`)
      .set(bearer(player1.accessToken))
      .expect(204);
    const cleared = await http.get(`${API}/users/me/favorites`).set(bearer(player1.accessToken)).expect(200);
    expect(cleared.body.map((item: { id: string }) => item.id)).not.toContain(fresh.id);
  });

  it('serves a single feedback item to its owner only', async () => {
    const created = await http
      .post(`${API}/feedback`)
      .set(bearer(player1.accessToken))
      .send({ title: 'Cannot find a match', message: 'Search returns nothing for my city lately.', type: 'BUG' })
      .expect(201);

    const mine = await http
      .get(`${API}/feedback/${created.body.id}`)
      .set(bearer(player1.accessToken))
      .expect(200);
    expect(mine.body).toMatchObject({ id: created.body.id, title: 'Cannot find a match', type: 'BUG' });

    await http.get(`${API}/feedback/${created.body.id}`).set(bearer(admin.accessToken)).expect(404);
  });

  it('summarises earnings and releases matured credits on demand', async () => {
    const summary = await http.get(`${API}/wallet/earnings/summary`).set(bearer(player1.accessToken)).expect(200);
    expect(summary.body).toEqual({
      today: expect.any(Number),
      thisMonth: expect.any(Number),
      total: expect.any(Number),
    });
    expect(summary.body.total).toBeGreaterThanOrEqual(summary.body.thisMonth);

    const released = await http
      .post(`${API}/wallet/pending-credits/release`)
      .set(bearer(player1.accessToken))
      .expect(200);
    expect(released.body).toEqual({ released: expect.any(Number) });
  });

  it('exposes per-order ratings to the two parties and filters reports by order', async () => {
    const order = await http
      .post(`${API}/orders`)
      .set(bearer(hirer1.accessToken))
      .send({ playerId: player1.user.id, hours: 1, message: 'Rating endpoint check', gameIds: [gameId] })
      .expect(201);

    const ratings = await http
      .get(`${API}/orders/${order.body.id}/ratings`)
      .set(bearer(hirer1.accessToken))
      .expect(200);
    expect(ratings.body).toEqual([]);

    await http.get(`${API}/orders/${order.body.id}/ratings`).set(bearer(admin.accessToken)).expect(403);

    const reports = await http
      .get(`${API}/reports/mine?scope=submitted&orderId=${order.body.id}`)
      .set(bearer(hirer1.accessToken))
      .expect(200);
    expect(reports.body.items).toEqual([]);
  });

  it('reports an on-time completion count in user summaries', async () => {
    const response = await http.get(`${API}/users/${player1.user.id}`).expect(200);

    expect(typeof response.body.onTimeCount).toBe('number');
    expect(response.body.onTimeCount).toBeLessThanOrEqual(response.body.completedOrdersCount);
  });

  it('updates an availability window in place', async () => {
    const existing = await http.get(`${API}/users/me/availability`).set(bearer(hirer1.accessToken)).expect(200);
    for (const window of existing.body as Array<{ id: string }>) {
      await http
        .delete(`${API}/users/me/availability/${window.id}`)
        .set(bearer(hirer1.accessToken))
        .expect(204);
    }

    await http
      .post(`${API}/users/me/availability`)
      .set(bearer(hirer1.accessToken))
      .send({ dayOfWeek: 1, startMinute: 540, endMinute: 660 })
      .expect(204);
    const windows = await http.get(`${API}/users/me/availability`).set(bearer(hirer1.accessToken)).expect(200);
    const monday = (windows.body as Array<{ id: string; dayOfWeek: number }>).find((item) => item.dayOfWeek === 1);
    if (!monday) throw new Error('Monday window was not created');

    const updated = await http
      .patch(`${API}/users/me/availability/${monday.id}`)
      .set(bearer(hirer1.accessToken))
      .send({ endMinute: 720 })
      .expect(200);
    expect(updated.body).toEqual({ id: monday.id, dayOfWeek: 1, startMinute: 540, endMinute: 720 });

    await http
      .post(`${API}/users/me/availability`)
      .set(bearer(hirer1.accessToken))
      .send({ dayOfWeek: 1, startMinute: 780, endMinute: 840 })
      .expect(204);

    await http
      .patch(`${API}/users/me/availability/${monday.id}`)
      .set(bearer(hirer1.accessToken))
      .send({ endMinute: 800 })
      .expect(409);
    await http
      .patch(`${API}/users/me/availability/${monday.id}`)
      .set(bearer(hirer1.accessToken))
      .send({ startMinute: 800, endMinute: 700 })
      .expect(400);
    await http
      .patch(`${API}/users/me/availability/00000000-0000-0000-0000-000000000000`)
      .set(bearer(hirer1.accessToken))
      .send({ endMinute: 700 })
      .expect(404);
  });

  it('returns behavior history newest first', async () => {
    await http
      .post(`${API}/admin/users/${hirer1.user.id}/behavior`)
      .set(bearer(admin.accessToken))
      .send({ points: -5, satisfaction: -2, note: 'History check' })
      .expect(200);

    await http.get(`${API}/users/me/behavior/history`).expect(401);

    const history = await http
      .get(`${API}/users/me/behavior/history?pageSize=5`)
      .set(bearer(hirer1.accessToken))
      .expect(200);

    expect(history.body.meta).toMatchObject({ page: 1, pageSize: 5 });
    const items = history.body.items as Array<{
      event: string;
      operation: string;
      pointType: string;
      amount: number;
      note: string | null;
      createdAt: string;
    }>;

    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'MANUAL_ADJUSTMENT', operation: 'SUB', pointType: 'POINTS', amount: 5 }),
        expect.objectContaining({ event: 'MANUAL_ADJUSTMENT', operation: 'SUB', pointType: 'SATISFACTION', amount: 2 }),
      ]),
    );
    expect(items.slice(0, 2).every((item) => item.note === 'History check')).toBe(true);

    const timestamps = items.map((item) => Date.parse(item.createdAt));
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it('reflects the caller view on public profiles', async () => {
    const anonymous = await http.get(`${API}/users/${player1.user.id}`).expect(200);
    expect(anonymous.body.isBlockedByMe).toBe(false);
    expect(anonymous.body.canHire).toBe(false);

    await http
      .post(`${API}/users/me/blocks`)
      .set(bearer(hirer1.accessToken))
      .send({ blockedUserId: player1.user.id })
      .expect(204);

    const asHirer = await http
      .get(`${API}/users/${player1.user.id}`)
      .set(bearer(hirer1.accessToken))
      .expect(200);
    expect(asHirer.body.isBlockedByMe).toBe(true);
    expect(asHirer.body.canHire).toBe(false);

    const asOwner = await http
      .get(`${API}/users/${player1.user.id}`)
      .set(bearer(player1.accessToken))
      .expect(200);
    expect(asOwner.body.isBlockedByMe).toBe(false);
    expect(asOwner.body.email).toBe('demo.player1@playtogether.local');

    await http
      .delete(`${API}/users/me/blocks/${player1.user.id}`)
      .set(bearer(hirer1.accessToken))
      .expect(204);
  });

  it('saves service pricing without forcing player mode on', async () => {
    const updated = await http
      .patch(`${API}/users/me/player-mode`)
      .set(bearer(hirer1.accessToken))
      .send({ enabled: false, pricePerHour: 120_000, maxHoursPerHire: 3 })
      .expect(200);

    expect(updated.body.isPlayer).toBe(false);
    expect(updated.body.pricePerHour).toBe(120_000);
    expect(updated.body.maxHoursPerHire).toBe(3);

    await http
      .patch(`${API}/users/me/player-mode`)
      .set(bearer(hirer1.accessToken))
      .send({ enabled: false, pricePerHour: 1_000 })
      .expect(400);
  });
});
