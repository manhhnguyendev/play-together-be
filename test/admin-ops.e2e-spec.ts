import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { escrowHolds, orders } from '../src/db/schema';
import { BackgroundJobs } from '../src/modules/jobs/background-jobs.service';
import { createTestApp, TEST_ADMIN, TEST_DEMO_PASSWORD, type TestApp } from './app.helper';

const API = '/api/v2';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Letters that exist only in Vietnamese orthography — the cheap test for
 * "this string was written for the operator, in the language they read". */
const VI_ONLY =
  /[ạảãăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i;

type Actor = { accessToken: string; user: { id: string; name: string; email: string } };
type OrderResponse = { id: string; status: string; totalPrice: number; playerPayout: number | null };

async function login(http: ReturnType<typeof request>, email: string, password: string): Promise<Actor> {
  const response = await http.post(`${API}/auth/login`).send({ email, password }).expect(200);
  return response.body as Actor;
}

/**
 * The read side of the console: order list + detail, the ledger, wallets,
 * deposits, escrows, the action trail and the period KPIs. The fixtures below
 * put one settled order, one disputed order, one payout and one top-up into the
 * database so the numbers asserted here are real, not empty arrays.
 */
describe('operations console reads (e2e)', () => {
  let harness: TestApp;
  let http: ReturnType<typeof request>;
  let jobs: BackgroundJobs;

  let hirer: Actor;
  let player: Actor;
  let superAdmin: Actor;
  let moderator: Actor;
  let finance: Actor;

  let gameId = '';
  let settledOrderId = '';
  let disputedOrderId = '';
  let withdrawalAmount = 0;
  let depositAmount = 0;
  let heldEscrowAmount = 0;

  const hire = async (message: string): Promise<OrderResponse> =>
    (
      await http
        .post(`${API}/orders`)
        .set(bearer(hirer.accessToken))
        .send({ playerId: player.user.id, hours: 1, message, gameIds: [gameId] })
        .expect(201)
    ).body as OrderResponse;

  /** Accept, then push the session clock past its end so the job can close it. */
  const runSessionToExpiry = async (message: string): Promise<OrderResponse> => {
    const created = await hire(message);
    await http.post(`${API}/orders/${created.id}/accept`).set(bearer(player.accessToken)).expect(200);
    await harness.db
      .update(orders)
      .set({ scheduledEndAt: new Date(Date.now() - 60_000) })
      .where(eq(orders.id, created.id));
    await jobs.runOnce();
    return created;
  };

  beforeAll(async () => {
    harness = await createTestApp();
    await harness.seed();
    http = request(harness.app.getHttpServer());
    jobs = harness.app.get(BackgroundJobs);

    hirer = await login(http, 'demo.hirer1@playtogether.local', TEST_DEMO_PASSWORD);
    player = await login(http, 'demo.player1@playtogether.local', TEST_DEMO_PASSWORD);
    superAdmin = await login(http, TEST_ADMIN.email, TEST_ADMIN.password);
    moderator = await login(http, 'demo.moderator@playtogether.local', TEST_DEMO_PASSWORD);
    finance = await login(http, 'demo.finance@playtogether.local', TEST_DEMO_PASSWORD);

    const games = await http.get(`${API}/games?pageSize=100`).expect(200);
    gameId = games.body.items.find((item: { name: string }) => item.name === 'Arena of Valor').id;

    // 1. A session that finished and was confirmed: escrow settled, ledger paid,
    //    rating written.
    const settled = await runSessionToExpiry('Confirmed session.');
    settledOrderId = settled.id;
    await http.post(`${API}/orders/${settledOrderId}/complete`).set(bearer(hirer.accessToken)).expect(200);
    await http
      .post(`${API}/orders/${settledOrderId}/ratings`)
      .set(bearer(hirer.accessToken))
      .send({ rate: 5, comment: 'Chuyên nghiệp, đúng giờ.' })
      .expect(201);

    // 2. A session that ran out while the payout is still being reconciled.
    const disputed = await runSessionToExpiry('Session still under review.');
    disputedOrderId = disputed.id;
    const [disputedRow] = await harness.db.select().from(orders).where(eq(orders.id, disputedOrderId));
    expect(disputedRow.status).toBe('DISPUTED');

    // 3. A session cut short: prorated settlement refunds part of the escrow.
    const early = await hire('Ending this one early.');
    await http.post(`${API}/orders/${early.id}/accept`).set(bearer(player.accessToken)).expect(200);
    // Half of the booked hour has to have run before the early end is allowed.
    await harness.db
      .update(orders)
      .set({ startsAt: new Date(Date.now() - 30 * 60_000) })
      .where(eq(orders.id, early.id));
    await http
      .post(`${API}/orders/${early.id}/end-early`)
      .set(bearer(hirer.accessToken))
      .send({ reason: 'Hẹn quá giờ, bên thuê phải đi trước.' })
      .expect(200);

    // 5. Money that left the platform.
    const deposit = await http
      .post(`${API}/wallet/deposits`)
      .set(bearer(player.accessToken))
      .send({ amount: 100_000 })
      .expect(201);
    depositAmount = 100_000;
    await http
      .post(`${API}/wallet/deposits/${deposit.body.id}/confirm`)
      .set(bearer(player.accessToken))
      .expect(200);

    withdrawalAmount = 50_000;
    const payout = await http
      .post(`${API}/wallet/withdrawals`)
      .set(bearer(hirer.accessToken))
      .send({ amount: withdrawalAmount })
      .expect(201);
    await http
      .patch(`${API}/admin/withdrawals/${payout.body.id}`)
      .set(bearer(finance.accessToken))
      .send({ status: 'PAID', note: 'Chuyển khoản MCV-OPS-0001' })
      .expect(200);

    await http
      .post(`${API}/admin/notifications/broadcast`)
      .set(bearer(moderator.accessToken))
      .send({ title: 'Bảo trì định kỳ', body: 'Hệ thống tạm nghỉ 20 phút.', reason: 'Thông báo lịch định kỳ' })
      .expect(200);

    const [hold] = await harness.db.select().from(escrowHolds).where(eq(escrowHolds.orderId, disputedOrderId));
    expect(hold.status).toBe('HELD');
    heldEscrowAmount = hold.amount - hold.settledAmount - hold.refundedAmount;
    expect(heldEscrowAmount).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await harness.app.close();
  });

  it('keeps the ops reads behind the same tiers as the console', async () => {
    await http.get(`${API}/admin/orders`).expect(401);

    const outsider = await http
      .get(`${API}/admin/orders`)
      .set(bearer(player.accessToken))
      .expect(403);
    expect(outsider.body.code).toBe('forbidden');

    // Money pages belong to FINANCE, and MODERATOR is not one.
    for (const path of ['/admin/money/ledger', '/admin/money/wallets', '/admin/money/deposits', '/admin/money/escrows']) {
      const denied = await http.get(`${API}${path}`).set(bearer(moderator.accessToken)).expect(403);
      expect(denied.body.code).toBe('admin_role_required');
    }

    // Both people- and money-facing tiers can follow an order.
    await http.get(`${API}/admin/orders`).set(bearer(moderator.accessToken)).expect(200);
    await http.get(`${API}/admin/orders`).set(bearer(finance.accessToken)).expect(200);
    await http.get(`${API}/admin/money/ledger`).set(bearer(finance.accessToken)).expect(200);
    await http.get(`${API}/admin/money/ledger`).set(bearer(superAdmin.accessToken)).expect(200);

    // The action trail is the super admin's oversight tool — the other tiers
    // can read it only as themselves, never as a way to watch their colleagues.
    const trailDenied = await http.get(`${API}/admin/audit-logs`).set(bearer(moderator.accessToken)).expect(403);
    expect(trailDenied.body.code).toBe('admin_role_required');
    await http.get(`${API}/admin/audit-logs`).set(bearer(superAdmin.accessToken)).expect(200);
    await http.get(`${API}/admin/kpis`).set(bearer(finance.accessToken)).expect(200);
  });

  it('lists orders with the parties, games and filters an operator needs', async () => {
    const all = await http
      .get(`${API}/admin/orders?pageSize=50`)
      .set(bearer(superAdmin.accessToken))
      .expect(200);

    expect(all.body.meta.total).toBeGreaterThanOrEqual(2);
    const ids: string[] = all.body.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(settledOrderId);
    expect(ids).toContain(disputedOrderId);

    const settledRow = all.body.items.find((item: { id: string }) => item.id === settledOrderId);
    expect(settledRow.status).toBe('SETTLED');
    expect(settledRow.hirer.name).toBe(hirer.user.name);
    expect(settledRow.player.name).toBe(player.user.name);
    expect(settledRow.games.map((game: { name: string }) => game.name)).toContain('Arena of Valor');
    expect(settledRow.playerPayout).toBeGreaterThan(0);

    const settledOnly = await http
      .get(`${API}/admin/orders?status=SETTLED&pageSize=50`)
      .set(bearer(superAdmin.accessToken))
      .expect(200);
    for (const item of settledOnly.body.items) expect(item.status).toBe('SETTLED');

    const byParty = await http
      .get(`${API}/admin/orders?playerId=${player.user.id}&pageSize=50`)
      .set(bearer(superAdmin.accessToken))
      .expect(200);
    expect(byParty.body.meta.total).toBeGreaterThanOrEqual(2);
    for (const item of byParty.body.items) expect(item.player.id).toBe(player.user.id);

    const byName = await http
      .get(`${API}/admin/orders?q=${encodeURIComponent(player.user.name)}`)
      .set(bearer(superAdmin.accessToken))
      .expect(200);
    expect(byName.body.meta.total).toBeGreaterThanOrEqual(2);

    const nobody = await http
      .get(`${API}/admin/orders?q=${encodeURIComponent('Không có ai tên này')}`)
      .set(bearer(superAdmin.accessToken))
      .expect(200);
    expect(nobody.body.items).toHaveLength(0);

    // Everything was created today, so a window in 2020 is empty.
    const outOfRange = await http
      .get(`${API}/admin/orders?from=2020-01-01T00:00:00.000Z&to=2020-12-31T23:59:59.999Z`)
      .set(bearer(superAdmin.accessToken))
      .expect(200);
    expect(outOfRange.body.items).toHaveLength(0);

    await http.get(`${API}/admin/orders?status=NOPE`).set(bearer(superAdmin.accessToken)).expect(400);
    await http.get(`${API}/admin/orders?sort=name`).set(bearer(superAdmin.accessToken)).expect(400);
  });

  it('explains one order end to end', async () => {
    const detail = await http
      .get(`${API}/admin/orders/${settledOrderId}`)
      .set(bearer(finance.accessToken))
      .expect(200);

    expect(detail.body.order.id).toBe(settledOrderId);
    expect(detail.body.message).toBe('Confirmed session.');
    expect(detail.body.disputeWindowHours).toBeNull();
    expect(detail.body.disputeClosesAt).toBeNull();

    const transitions = detail.body.history.map((item: { toStatus: string }) => item.toStatus);
    expect(transitions).toEqual(expect.arrayContaining(['LIVE', 'DISPUTED', 'SETTLED']));

    expect(detail.body.escrow.status).toBe('SETTLED');
    expect(detail.body.escrow.heldAmount).toBe(0);
    expect(detail.body.escrow.settledAmount).toBe(detail.body.order.totalPrice);

    const types: string[] = detail.body.ledger.map((entry: { type: string }) => entry.type);
    expect(types).toEqual(expect.arrayContaining(['ESCROW_HOLD', 'ORDER_EARNING', 'PLATFORM_FEE']));

    expect(detail.body.ratings).toHaveLength(1);
    expect(detail.body.ratings[0].rate).toBe(5);
    expect(detail.body.ratings[0].rater.id).toBe(hirer.user.id);
    expect(detail.body.reports).toHaveLength(0);

    // The pending credit exists but has not been released yet.
    expect(detail.body.pendingCredits.length).toBeGreaterThanOrEqual(1);
    for (const credit of detail.body.pendingCredits) expect(credit.releasedAt).toBeNull();

    const inDispute = await http
      .get(`${API}/admin/orders/${disputedOrderId}`)
      .set(bearer(moderator.accessToken))
      .expect(200);
    expect(inDispute.body.disputeWindowHours).toBeGreaterThan(0);
    expect(inDispute.body.disputeClosesAt).toBeTruthy();
    expect(inDispute.body.escrow.status).toBe('HELD');
    expect(inDispute.body.order.playerPayout).toBeNull();

    const missing = await http
      .get(`${API}/admin/orders/${randomUUID()}`)
      .set(bearer(superAdmin.accessToken))
      .expect(404);
    expect(missing.body.code).toBe('order_not_found');
    await http.get(`${API}/admin/orders/not-a-uuid`).set(bearer(superAdmin.accessToken)).expect(400);
  });

  it('walks the action trail with filters', async () => {
    const all = await http
      .get(`${API}/admin/audit-logs?pageSize=50`)
      .set(bearer(superAdmin.accessToken))
      .expect(200);

    const actions: string[] = all.body.items.map((item: { action: string }) => item.action);
    expect(actions).toContain('withdrawal.resolve');
    expect(actions).toContain('notification.broadcast');

    const payout = all.body.items.find((item: { action: string }) => item.action === 'withdrawal.resolve');
    expect(payout.admin.name).toBe('Tài Chính');
    expect(payout.admin.adminRole).toBe('FINANCE');
    expect(payout.reason).toBe('Chuyển khoản MCV-OPS-0001');
    expect(payout.detail.amount).toBe(withdrawalAmount);

    const onlyBroadcast = await http
      .get(`${API}/admin/audit-logs?action=notification.broadcast`)
      .set(bearer(superAdmin.accessToken))
      .expect(200);
    expect(onlyBroadcast.body.items).toHaveLength(1);
    expect(onlyBroadcast.body.items[0].admin.name).toBe(moderator.user.name);
    expect(onlyBroadcast.body.meta.total).toBe(1);

    const byAdmin = await http
      .get(`${API}/admin/audit-logs?adminId=${moderator.user.id}`)
      .set(bearer(superAdmin.accessToken))
      .expect(200);
    for (const item of byAdmin.body.items) expect(item.admin.id).toBe(moderator.user.id);

    const byEntity = await http
      .get(`${API}/admin/audit-logs?entity=withdrawal&entityId=${randomUUID()}`)
      .set(bearer(superAdmin.accessToken))
      .expect(200);
    expect(byEntity.body.items).toHaveLength(0);

    const future = await http
      .get(`${API}/admin/audit-logs?from=2030-01-01T00:00:00.000Z`)
      .set(bearer(superAdmin.accessToken))
      .expect(200);
    expect(future.body.items).toHaveLength(0);

    await http.get(`${API}/admin/audit-logs?from=nonsense`).set(bearer(superAdmin.accessToken)).expect(400);
  });

  it('reports ledger totals over the whole set and pages without gaps', async () => {
    const first = await http
      .get(`${API}/admin/money/ledger?pageSize=2&page=1`)
      .set(bearer(finance.accessToken))
      .expect(200);

    expect(first.body.items.length).toBeLessThanOrEqual(2);
    expect(first.body.meta.total).toBeGreaterThan(2);
    expect(first.body.totals.entries).toBe(first.body.meta.total);

    let debits = 0;
    let credits = 0;
    let seen = 0;
    const ids = new Set<string>();
    let page = 1;
    for (;;) {
      const response = await http
        .get(`${API}/admin/money/ledger?pageSize=2&page=${page}`)
        .set(bearer(finance.accessToken))
        .expect(200);
      for (const item of response.body.items) {
        // A page that repeats a row means the sort key has ties, and an operator
        // paging through the ledger would silently miss money.
        expect(ids.has(item.id)).toBe(false);
        ids.add(item.id);
        if (item.direction === 'DEBIT') debits += item.amount;
        else credits += item.amount;
      }
      seen += response.body.items.length;
      if (page >= response.body.meta.totalPages) break;
      page += 1;
    }

    expect(seen).toBe(first.body.meta.total);
    expect(first.body.totals.debits).toBe(debits);
    expect(first.body.totals.credits).toBe(credits);

    const fees = await http
      .get(`${API}/admin/money/ledger?type=PLATFORM_FEE`)
      .set(bearer(finance.accessToken))
      .expect(200);
    for (const item of fees.body.items) {
      expect(item.type).toBe('PLATFORM_FEE');
      expect(item.holder).toBe('Play Together (nền tảng)');
    }
    expect(fees.body.totals.credits).toBeGreaterThan(0);

    const forOrder = await http
      .get(`${API}/admin/money/ledger?orderId=${settledOrderId}`)
      .set(bearer(finance.accessToken))
      .expect(200);
    for (const item of forOrder.body.items) expect(item.orderId).toBe(settledOrderId);

    const userEntries = await http
      .get(`${API}/admin/money/ledger?accountType=USER&pageSize=100`)
      .set(bearer(finance.accessToken))
      .expect(200);
    const accountNames = new Set(
      (
        await http
          .get(`${API}/admin/money/wallets?pageSize=100`)
          .set(bearer(finance.accessToken))
          .expect(200)
      ).body.items.map((wallet: { name: string }) => wallet.name),
    );
    for (const item of userEntries.body.items) {
      expect(item.holder).not.toBeNull();
      expect(accountNames.has(item.holder)).toBe(true);
    }

    await http.get(`${API}/admin/money/ledger?minAmount=-1`).set(bearer(finance.accessToken)).expect(400);
  });

  it('shows wallets, deposits and escrows the way finance needs them', async () => {
    const wallets = await http
      .get(`${API}/admin/money/wallets?pageSize=50`)
      .set(bearer(finance.accessToken))
      .expect(200);

    const playerWallet = wallets.body.items.find((item: { userId: string }) => item.userId === player.user.id);
    expect(playerWallet.email).toBe(player.user.email);
    expect(playerWallet.availableBalance).toBeGreaterThan(0);

    const balances: number[] = wallets.body.items.map((item: { availableBalance: number }) => item.availableBalance);
    expect(balances).toEqual([...balances].sort((a, b) => b - a));

    const pendingOnly = await http
      .get(`${API}/admin/money/wallets?pendingOnly=true&pageSize=50`)
      .set(bearer(finance.accessToken))
      .expect(200);
    for (const item of pendingOnly.body.items) {
      expect(item.pendingCount).toBeGreaterThan(0);
      expect(item.pendingAmount).toBeGreaterThan(0);
    }
    const playerPending = pendingOnly.body.items.find((item: { userId: string }) => item.userId === player.user.id);
    expect(playerPending).toBeTruthy();

    const deposits = await http
      .get(`${API}/admin/money/deposits?status=SUCCEEDED`)
      .set(bearer(finance.accessToken))
      .expect(200);
    expect(deposits.body.items.length).toBeGreaterThanOrEqual(1);
    expect(deposits.body.items[0].amount).toBe(depositAmount);
    expect(deposits.body.items[0].completedAt).toBeTruthy();
    expect(deposits.body.items[0].user.id).toBe(player.user.id);

    const escrows = await http
      .get(`${API}/admin/money/escrows?status=HELD`)
      .set(bearer(finance.accessToken))
      .expect(200);
    const held = escrows.body.items.filter((item: { orderId: string }) => item.orderId === disputedOrderId);
    expect(held).toHaveLength(1);
    expect(held[0].heldAmount).toBe(held[0].amount);
    // totalHeld follows the filter, so with status=HELD it is the whole holding.
    expect(escrows.body.totalHeld).toBe(heldEscrowAmount);

    const settledHolds = await http
      .get(`${API}/admin/money/escrows?status=SETTLED`)
      .set(bearer(finance.accessToken))
      .expect(200);
    for (const item of settledHolds.body.items) expect(item.heldAmount).toBe(0);
  });

  it('computes period KPIs from the real ledger, not from table counts', async () => {
    const kpis = await http.get(`${API}/admin/kpis`).set(bearer(superAdmin.accessToken)).expect(200);

    expect(new Date(kpis.body.from).getTime()).toBeLessThanOrEqual(new Date(kpis.body.to).getTime());

    // Three sessions were created in this window: one confirmed, one still under
    // review, one cut short.
    expect(kpis.body.orders.created).toBe(3);
    expect(kpis.body.orders.disputed).toBe(2);
    expect(kpis.body.orders.settled).toBe(1);
    expect(kpis.body.orders.endedEarly).toBe(1);
    expect(kpis.body.orders.completed).toBe(2);
    expect(kpis.body.orders.closed).toBe(0);
    expect(kpis.body.orders.endedEarlyRateBps).toBe(5_000);

    expect(kpis.body.money.platformFees).toBeGreaterThan(0);
    expect(kpis.body.money.playerPayouts).toBeGreaterThan(0);
    expect(kpis.body.money.payoutsPaid).toBe(withdrawalAmount);
    expect(kpis.body.money.depositsSucceeded).toBe(depositAmount);
    expect(kpis.body.money.donations).toBeGreaterThan(0);

    // The prorated refund equals the credit side of every refund entry, which is
    // what the ledger page reports independently.
    const refundPages = await Promise.all(
      ['ESCROW_REFUND', 'REPORT_REFUND', 'MAINTENANCE_REFUND'].map((type) =>
        http.get(`${API}/admin/money/ledger?type=${type}`).set(bearer(finance.accessToken)).expect(200),
      ),
    );
    const refunded = refundPages.reduce((sum, page) => sum + page.body.totals.credits, 0);
    expect(refunded).toBeGreaterThan(0);
    expect(kpis.body.money.refunds).toBe(refunded);

    // The disputed order is the only money still held, and the payout queue is
    // empty again because this spec resolved the one request.
    expect(kpis.body.queue.escrowHeld).toBe(heldEscrowAmount);
    expect(kpis.body.queue.pendingUserWithdrawals).toBe(0);
    expect(kpis.body.queue.pendingUserWithdrawalAmount).toBe(0);
    expect(kpis.body.queue.pendingCharityWithdrawals).toBe(0);
    expect(kpis.body.queue.pendingReports).toBe(0);
    expect(kpis.body.queue.flaggedRatings).toBe(0);
    expect(kpis.body.queue.pendingCredits).toBeGreaterThan(0);

    expect(kpis.body.people.registered).toBeGreaterThan(0);
    expect(kpis.body.people.activePlayers).toBeGreaterThan(0);
    expect(kpis.body.people.ratingsCreated).toBe(1);
    expect(kpis.body.people.averageRating).toBe(5);

    const emptyWindow = await http
      .get(`${API}/admin/kpis?from=2020-01-01T00:00:00.000Z&to=2020-12-31T23:59:59.999Z`)
      .set(bearer(superAdmin.accessToken))
      .expect(200);
    expect(emptyWindow.body.orders.created).toBe(0);
    expect(emptyWindow.body.money.playerPayouts).toBe(0);
    expect(emptyWindow.body.money.depositsSucceeded).toBe(0);
    expect(emptyWindow.body.people.averageRating).toBeNull();
    // The queue is a snapshot, so it survives an empty period.
    expect(emptyWindow.body.queue.escrowHeld).toBe(kpis.body.queue.escrowHeld);

    const inverted = await http
      .get(`${API}/admin/kpis?from=2026-06-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z`)
      .set(bearer(superAdmin.accessToken))
      .expect(422);
    expect(inverted.body.code).toBe('validation_failed');
  });

  it('assembles one account into a dossier an operator can act on', async () => {
    const denied = await http
      .get(`${API}/admin/users/${player.user.id}`)
      .set(bearer(player.accessToken))
      .expect(403);
    expect(denied.body.code).toBe('forbidden');

    // The seeded account sits at the behaviour ceiling, so the five-star rating
    // it received could not add anything and wrote no trail row. A manual edit
    // is what puts a movement on the history the dossier has to show.
    await http
      .post(`${API}/admin/users/${player.user.id}/behavior`)
      .set(bearer(moderator.accessToken))
      .send({ points: -10, satisfaction: -20, note: 'Bỏ hẹn giờ đã xác nhận.' })
      .expect(200);

    const dossier = await http
      .get(`${API}/admin/users/${player.user.id}`)
      .set(bearer(moderator.accessToken))
      .expect(200);

    expect(dossier.body.account.id).toBe(player.user.id);
    // The console view is the one that carries the email and the back-office tier.
    expect(dossier.body.account.email).toBe(player.user.email);
    expect(dossier.body.account.adminRole).toBeNull();
    expect(dossier.body.account.role).toBe('USER');

    expect(dossier.body.behavior.points).toBe(90);
    expect(dossier.body.behavior.satisfaction).toBe(80);
    const events: string[] = dossier.body.behavior.history.map((item: { event: string }) => item.event);
    expect(events).toEqual(['MANUAL_ADJUSTMENT', 'MANUAL_ADJUSTMENT']);
    expect(dossier.body.behavior.history[0].note).toBe('Bỏ hẹn giờ đã xác nhận.');

    // Three sessions were booked with this account as the player, and the one
    // still under review is the only one that has not reached an end.
    expect(dossier.body.orders.asPlayer).toBe(3);
    expect(dossier.body.orders.asHirer).toBe(0);
    expect(dossier.body.orders.open).toBe(1);
    expect(dossier.body.orders.recent.length).toBeGreaterThan(0);
    for (const row of dossier.body.orders.recent) {
      expect([row.hirer.id, row.player.id]).toContain(player.user.id);
    }

    // The top-up is spendable and the session fee is still inside its window.
    expect(dossier.body.wallet.availableBalance).toBeGreaterThanOrEqual(depositAmount);
    expect(dossier.body.wallet.pendingAmount).toBeGreaterThan(0);
    expect(dossier.body.wallet.pendingCount).toBeGreaterThan(0);

    expect(dossier.body.moderation.openReportsAgainst).toBe(0);
    expect(dossier.body.moderation.flaggedRatings).toBe(0);
    expect(dossier.body.moderation.pendingWithdrawals).toBe(0);

    // The hirer is the account that asked for a payout, and it was paid out.
    const hirerDossier = await http
      .get(`${API}/admin/users/${hirer.user.id}`)
      .set(bearer(finance.accessToken))
      .expect(200);
    expect(hirerDossier.body.orders.asHirer).toBe(3);
    expect(hirerDossier.body.moderation.pendingWithdrawals).toBe(0);

    const adminDossier = await http
      .get(`${API}/admin/users/${superAdmin.user.id}`)
      .set(bearer(superAdmin.accessToken))
      .expect(200);
    expect(adminDossier.body.account.adminRole).toBe('SUPER_ADMIN');
    expect(adminDossier.body.wallet.pendingAmount).toBe(0);
    expect(adminDossier.body.orders.recent).toHaveLength(0);

    const missing = await http
      .get(`${API}/admin/users/${randomUUID()}`)
      .set(bearer(moderator.accessToken))
      .expect(404);
    expect(missing.body.code).toBe('user_not_found');
    await http.get(`${API}/admin/users/not-a-uuid`).set(bearer(moderator.accessToken)).expect(400);
  });

  it('writes the money trail and the configuration list in Vietnamese', async () => {
    const ledger = await http
      .get(`${API}/admin/money/ledger?pageSize=100`)
      .set(bearer(finance.accessToken))
      .expect(200);

    const notesByType = new Map<string, Set<string>>();
    for (const item of ledger.body.items as Array<{ type: string; note: string | null }>) {
      const notes = notesByType.get(item.type) ?? new Set<string>();
      notes.add(item.note ?? '');
      notesByType.set(item.type, notes);
    }

    const notesOf = (type: string): string[] => [...(notesByType.get(type) ?? [])];
    expect(notesOf('DEPOSIT')).toContain('Nạp tiền qua MoMo');
    expect(notesOf('WITHDRAWAL')).toContain('Yêu cầu rút tiền');
    expect(notesOf('ESCROW_HOLD')).toContain('Tạm giữ tiền cho đơn thuê');
    expect(notesOf('ORDER_EARNING')).toContain('Doanh thu đơn thuê (chờ về ví)');
    expect(notesOf('PLATFORM_FEE')).toContain('Phí nền tảng');

    // The console prints `note` verbatim, so anything the system writes without
    // a single Vietnamese letter is English copy reaching the person on shift.
    const systemWritten = [
      'DEPOSIT',
      'WITHDRAWAL',
      'ESCROW_HOLD',
      'ESCROW_RELEASE',
      'ESCROW_REFUND',
      'ORDER_EARNING',
      'PLATFORM_FEE',
      'DONATION',
      'REPORT_REFUND',
    ];
    const unreadable = [...notesByType.entries()]
      .filter(([type]) => systemWritten.includes(type))
      .flatMap(([type, notes]) =>
        [...notes].filter((note) => !VI_ONLY.test(note)).map((note) => `${type}: ${note}`),
      );
    expect(unreadable).toEqual([]);

    const configs = await http.get(`${API}/admin/configs`).set(bearer(finance.accessToken)).expect(200);
    expect(Array.isArray(configs.body)).toBe(true);
    expect(configs.body.length).toBeGreaterThanOrEqual(6);
    for (const item of configs.body as Array<{ title: string; description: string | null }>) {
      expect(VI_ONLY.test(item.title)).toBe(true);
      expect(VI_ONLY.test(item.description ?? '')).toBe(true);
    }
  });
});
