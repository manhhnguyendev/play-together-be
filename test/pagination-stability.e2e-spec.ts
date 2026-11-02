import request from 'supertest';
import { createTestApp, TEST_ADMIN, TEST_DEMO_PASSWORD, type TestApp } from './app.helper';
import { notifications } from '../src/db/schema';

const API = '/api/v2';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

type Page = { items: { id: string }[]; meta: { total: number} };
type Walked = { ids: string[]; total: number };

/**
 * Paging over a column that is not unique is only correct when the query pins
 * the remaining ties. These lists order by `createdAt`, and the seed writes
 * dozens of rows sharing one timestamp, so without an id tiebreaker a row can
 * land on two pages while another never appears at all.
 */
describe('page-walk stability (e2e)', () => {
  let harness: TestApp;
  let http: ReturnType<typeof request>;
  let playerToken = '';
  let playerId = '';
  let adminToken = '';
  let burstIds: string[] = [];

  /** Reads every page of `url` and returns the ids in the order they arrived. */
  async function walkPages(url: string, token: string, pageSize: number): Promise<Walked> {
    const ids: string[] = [];
    let total = 0;
    for (let page = 1; page <= 40; page += 1) {
      const res = await http
        .get(`${API}${url}${url.includes('?') ? '&' : '?'}page=${page}&pageSize=${pageSize}`)
        .set(bearer(token))
        .expect(200);
      const body = res.body as Page;
      total = body.meta.total;
      ids.push(...body.items.map((item) => item.id));
      if (body.items.length < pageSize || ids.length >= total) break;
    }
    return { ids, total };
  }

  beforeAll(async () => {
    harness = await createTestApp();
    await harness.seed();
    http = request(harness.app.getHttpServer());

    const player = await http
      .post(`${API}/auth/login`)
      .send({ email: 'demo.player1@playtogether.local', password: TEST_DEMO_PASSWORD })
      .expect(200);
    playerToken = player.body.accessToken as string;
    playerId = player.body.user.id as string;

    const admin = await http
      .post(`${API}/auth/login`)
      .send({ email: TEST_ADMIN.email, password: TEST_ADMIN.password })
      .expect(200);
    adminToken = admin.body.accessToken as string;

    // Six notifications stamped in the same second, newer than anything the seed
    // wrote. They own the first pages of `/notifications`, which makes that list
    // both a multi-page walk and a test of the tie order.
    const tied = new Date(Date.now() + 3_600_000);
    const inserted = await harness.db
      .insert(notifications)
      .values(
        Array.from({ length: 6 }, (_, index) => ({
          userId: playerId,
          title: `Trùng timestamp ${index}`,
          body: 'Kiểm tra khoá phụ khi hai dòng cùng giờ tạo',
          createdAt: tied,
        })),
      )
      .returning({ id: notifications.id });
    burstIds = inserted.map((row) => row.id);
  });

  afterAll(() => harness.app.close());

  const targets = [
    { label: 'notifications', url: '/notifications', token: () => playerToken },
    { label: 'orders', url: '/orders', token: () => playerToken },
    { label: 'wallet transactions', url: '/wallet/transactions', token: () => playerToken },
    { label: 'player search (ranking)', url: '/users?sort=ranking', token: () => playerToken },
    { label: 'player search (newest)', url: '/users?sort=newest', token: () => playerToken },
    { label: 'admin users', url: '/admin/users', token: () => adminToken },
    { label: 'games catalogue', url: '/games', token: () => playerToken },
  ];

  it.each(targets)('page-walks $label without duplicating or dropping a row', async ({ url, token }) => {
    const { ids, total } = await walkPages(url, token(), 3);
    // Reading one row twice means another never showed up; both keep the length
    // at `total`, so the set and the length have to be checked together.
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(total);
  });

  it('keeps enough multi-page lists for the walk to mean something', async () => {
    const totals = await Promise.all(
      targets.map(async ({ url, token }) => {
        const res = await http.get(`${API}${url}${url.includes('?') ? '&' : '?'}page=1&pageSize=1`).set(bearer(token()));
        return (res.body as Page).meta.total;
      }),
    );
    expect(totals.filter((total) => total > 3).length).toBeGreaterThanOrEqual(5);
  });

  it('orders rows that share one timestamp by id, not by luck', async () => {
    expect(burstIds).toHaveLength(6);

    const oneShot = await http
      .get(`${API}/notifications?page=1&pageSize=100`)
      .set(bearer(playerToken))
      .expect(200);
    const head = (oneShot.body as Page).items.slice(0, 6).map((item) => item.id);
    expect(new Set(head)).toEqual(new Set(burstIds));
    // Same timestamp means the id is the only thing left to order by, and the
    // queries pair `createdAt DESC` with `id DESC` — a heap-order accident would
    // show up here as insertion order instead.
    expect(head).toEqual([...burstIds].sort().reverse());

    const walked = await walkPages('/notifications', playerToken, 2);
    expect(walked.ids.slice(0, 6)).toEqual(head);
  });
});
