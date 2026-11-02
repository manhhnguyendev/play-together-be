import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { asc } from 'drizzle-orm';
import { adminAuditLogs, SUPER_ADMIN_ROLE } from '../src/db/schema';
import { createTestApp, TEST_ADMIN, TEST_CHARITY, TEST_DEMO_PASSWORD, type TestApp } from './app.helper';

const API = '/api/v2';

type Actor = { accessToken: string; user: { id: string } };

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(http: ReturnType<typeof request>, email: string, password: string): Promise<Actor> {
  const response = await http.post(`${API}/auth/login`).send({ email, password }).expect(200);
  return response.body as Actor;
}

const codeOf = (response: request.Response): string => response.body.code;

const CONFIG_DELETE_REASON = 'Xoá cờ tạm sau kiểm thử';

describe('admin tiers and audit log (e2e)', () => {
  let harness: TestApp;
  let http: ReturnType<typeof request>;

  let superAdmin: Actor;
  let moderator: Actor;
  let finance: Actor;
  let player: Actor;
  let playerId = '';

  const auditRows = () =>
    harness.db
      .select()
      .from(adminAuditLogs)
      .orderBy(asc(adminAuditLogs.createdAt));

  beforeAll(async () => {
    harness = await createTestApp();
    await harness.seed();
    http = request(harness.app.getHttpServer());

    superAdmin = await login(http, TEST_ADMIN.email, TEST_ADMIN.password);
    moderator = await login(http, 'demo.moderator@playtogether.local', TEST_DEMO_PASSWORD);
    finance = await login(http, 'demo.finance@playtogether.local', TEST_DEMO_PASSWORD);
    player = await login(http, 'demo.player1@playtogether.local', TEST_DEMO_PASSWORD);

    const players = await http
      .get(`${API}/admin/users?role=USER&isPlayer=true&pageSize=1`)
      .set(bearer(superAdmin.accessToken))
      .expect(200);
    playerId = players.body.items[0].id;
  });

  afterAll(async () => {
    await harness.app.close();
  });

  it('lets every tier read the console and keeps everyone else out', async () => {
    for (const actor of [superAdmin, moderator, finance]) {
      await http.get(`${API}/admin/stats`).set(bearer(actor.accessToken)).expect(200);
    }

    await http.get(`${API}/admin/stats`).expect(401);

    const blocked = await http.get(`${API}/admin/stats`).set(bearer(player.accessToken)).expect(403);
    expect(codeOf(blocked)).toBe('forbidden');
  });

  it('scopes people-facing routes to MODERATOR', async () => {
    await http.get(`${API}/admin/users`).set(bearer(moderator.accessToken)).expect(200);

    await http
      .post(`${API}/admin/notifications/broadcast`)
      .set(bearer(moderator.accessToken))
      .send({ title: 'Bảo trì định kỳ', body: 'Hệ thống tạm nghỉ 20 phút.', reason: 'Thông báo lịch định kỳ' })
      .expect(200);

    const payouts = await http
      .get(`${API}/admin/withdrawals`)
      .set(bearer(moderator.accessToken))
      .expect(403);
    expect(codeOf(payouts)).toBe('admin_role_required');

    const maintenance = await http
      .post(`${API}/admin/maintenance`)
      .set(bearer(moderator.accessToken))
      .send({ enabled: false })
      .expect(403);
    expect(codeOf(maintenance)).toBe('admin_role_required');
  });

  it('scopes money routes to FINANCE', async () => {
    await http.get(`${API}/admin/withdrawals`).set(bearer(finance.accessToken)).expect(200);
    await http.get(`${API}/admin/configs`).set(bearer(finance.accessToken)).expect(200);

    const created = await http
      .post(`${API}/admin/configs`)
      .set(bearer(finance.accessToken))
      .send({
        key: 'audit.probe_flag',
        no: 999,
        title: 'Audit probe',
        value: 1,
        reason: 'Cờ tạm cho luồng kiểm thử RBAC',
      })
      .expect(201);
    expect(created.body.value).toBe(1);

    await http
      .delete(`${API}/admin/configs/${created.body.id}?reason=${encodeURIComponent(CONFIG_DELETE_REASON)}`)
      .set(bearer(finance.accessToken))
      .expect(204);

    const people = await http
      .get(`${API}/admin/users`)
      .set(bearer(finance.accessToken))
      .expect(403);
    expect(codeOf(people)).toBe('admin_role_required');
  });

  it('lets SUPER_ADMIN through every gate', async () => {
    await http.get(`${API}/admin/users`).set(bearer(superAdmin.accessToken)).expect(200);
    await http.get(`${API}/admin/withdrawals`).set(bearer(superAdmin.accessToken)).expect(200);
    await http
      .post(`${API}/admin/maintenance`)
      .set(bearer(superAdmin.accessToken))
      .send({ enabled: false, reason: 'Kiểm thử quyền super admin' })
      .expect(200);

    const gameType = await http
      .post(`${API}/admin/game-types`)
      .set(bearer(superAdmin.accessToken))
      .send({ name: 'Audit Probe Type' })
      .expect(201);

    const outsider = await http
      .post(`${API}/admin/game-types`)
      .set(bearer(finance.accessToken))
      .send({ name: 'Audit Probe Type Two' })
      .expect(403);
    expect(codeOf(outsider)).toBe('admin_role_required');

    await http
      .delete(`${API}/admin/game-types/${gameType.body.id}`)
      .set(bearer(superAdmin.accessToken))
      .expect(204);
  });

  it('demands a reason for every privilege change', async () => {
    const noReason = await http
      .patch(`${API}/admin/users/${playerId}`)
      .set(bearer(moderator.accessToken))
      .send({ isActive: false })
      .expect(422);
    expect(codeOf(noReason)).toBe('reason_required');

    const tierWithoutAdmin = await http
      .patch(`${API}/admin/users/${playerId}`)
      .set(bearer(superAdmin.accessToken))
      .send({ adminRole: 'FINANCE', reason: 'Gắn sai bậc' })
      .expect(422);
    expect(codeOf(tierWithoutAdmin)).toBe('validation_failed');

    await http
      .patch(`${API}/admin/users/${playerId}`)
      .set(bearer(moderator.accessToken))
      .send({ isActive: false, reason: 'Khảo thí nhiều tài khoản' })
      .expect(200);

    const unlocked = await http
      .patch(`${API}/admin/users/${playerId}`)
      .set(bearer(moderator.accessToken))
      .send({ isActive: true, reason: 'Đã xác minh lại' })
      .expect(200);
    expect(unlocked.body.isActive).toBe(true);
  });

  it('keeps role and tier assignment to SUPER_ADMIN', async () => {
    // The console disables this field for a moderator, but the API is the guard:
    // whoever can write `adminRole` can appoint themselves.
    const selfTier = await http
      .patch(`${API}/admin/users/${moderator.user.id}`)
      .set(bearer(moderator.accessToken))
      .send({ adminRole: SUPER_ADMIN_ROLE, reason: 'Tự nâng quyền' })
      .expect(403);
    expect(codeOf(selfTier)).toBe('admin_role_required');

    const stillModerator = await http
      .get(`${API}/admin/users/${moderator.user.id}`)
      .set(bearer(superAdmin.accessToken))
      .expect(200);
    expect(stillModerator.body.account.adminRole).toBe('MODERATOR');

    const promoteStranger = await http
      .patch(`${API}/admin/users/${playerId}`)
      .set(bearer(moderator.accessToken))
      .send({ role: 'ADMIN', reason: 'Kết nạp quản trị viên' })
      .expect(403);
    expect(codeOf(promoteStranger)).toBe('admin_role_required');

    // Presence and locking stay with the moderator — no reason needed for a
    // status tweak, and the account keeps its tier.
    const presence = await http
      .patch(`${API}/admin/users/${playerId}`)
      .set(bearer(moderator.accessToken))
      .send({ status: 'BUSY' })
      .expect(200);
    expect(presence.body.status).toBe('BUSY');
    expect(presence.body.role).toBe('USER');
    expect(presence.body.adminRole).toBeNull();
  });

  it('refuses to lose the last super admin', async () => {
    const selfDemote = await http
      .patch(`${API}/admin/users/${superAdmin.user.id}`)
      .set(bearer(superAdmin.accessToken))
      .send({ adminRole: 'MODERATOR', reason: 'Bàn giao' })
      .expect(409);
    expect(codeOf(selfDemote)).toBe('last_super_admin');

    const lockLast = await http
      .patch(`${API}/admin/users/${superAdmin.user.id}`)
      .set(bearer(moderator.accessToken))
      .send({ isActive: false, reason: 'Khoá admin' })
      .expect(409);
    expect(codeOf(lockLast)).toBe('last_super_admin');

    await http
      .patch(`${API}/admin/users/${moderator.user.id}`)
      .set(bearer(superAdmin.accessToken))
      .send({ adminRole: SUPER_ADMIN_ROLE, reason: 'Cần thêm một super admin trực' })
      .expect(200);

    // A second active super admin exists, so the very same call is now allowed.
    await http
      .patch(`${API}/admin/users/${superAdmin.user.id}`)
      .set(bearer(moderator.accessToken))
      .send({ isActive: false, reason: 'Khoá để thử hàng đợi' })
      .expect(200);

    const secondSuper = await login(http, 'demo.moderator@playtogether.local', TEST_DEMO_PASSWORD);
    await http
      .patch(`${API}/admin/users/${superAdmin.user.id}`)
      .set(bearer(secondSuper.accessToken))
      .send({ isActive: true, reason: 'Mở khoá lại tài khoản chính' })
      .expect(200);

    await http
      .patch(`${API}/admin/users/${secondSuper.user.id}`)
      .set(bearer(secondSuper.accessToken))
      .send({ adminRole: 'MODERATOR', reason: 'Trả lại bậc kiểm duyệt' })
      .expect(200);

    superAdmin = await login(http, TEST_ADMIN.email, TEST_ADMIN.password);
  });

  it('demands a note before a payout decision and still finds nothing to pay', async () => {
    const missingNote = await http
      .patch(`${API}/admin/withdrawals/${randomUUID()}`)
      .set(bearer(finance.accessToken))
      .send({ status: 'PAID' })
      .expect(400);
    expect(codeOf(missingNote)).toBe('validation_failed');

    const noSuchRow = await http
      .patch(`${API}/admin/withdrawals/${randomUUID()}`)
      .set(bearer(finance.accessToken))
      .send({ status: 'PAID', note: 'Chuyển khoản 2026/11/01' })
      .expect(404);
    expect(codeOf(noSuchRow)).toBe('withdrawal_not_found');
  });

  it('audits a real payout decision end to end', async () => {
    const hirer = await login(http, 'demo.hirer1@playtogether.local', TEST_DEMO_PASSWORD);
    const requested = await http
      .post(`${API}/wallet/withdrawals`)
      .set(bearer(hirer.accessToken))
      .send({ amount: 50_000 })
      .expect(201);

    const resolved = await http
      .patch(`${API}/admin/withdrawals/${requested.body.id}`)
      .set(bearer(finance.accessToken))
      .send({ status: 'PAID', note: 'Chuyển khoản MCV-TEST-0001' })
      .expect(200);
    expect(resolved.body.status).toBe('PAID');

    // Re-deciding the same payout must fail before it can write a second row.
    await http
      .patch(`${API}/admin/withdrawals/${requested.body.id}`)
      .set(bearer(finance.accessToken))
      .send({ status: 'REJECTED', note: 'Nhầm lệnh chi' })
      .expect(409);
  });

  it('audits a charity payout rejection and returns the money', async () => {
    const charity = await login(http, TEST_CHARITY.email, TEST_CHARITY.password);
    const requested = await http
      .post(`${API}/me/charity/withdrawals`)
      .set(bearer(charity.accessToken))
      .send({ amount: 20_000, note: 'Trao học bổng kỳ 1' })
      .expect(201);

    const rejected = await http
      .patch(`${API}/admin/charity-withdrawals/${requested.body.id}`)
      .set(bearer(finance.accessToken))
      .send({ decision: 'REJECTED', note: 'Thiếu số tài khoản nhận' })
      .expect(200);
    expect(rejected.body.status).toBe('REJECTED');
  });

  it('audits a feedback decision made by a moderator', async () => {
    const posted = await http
      .post(`${API}/feedback`)
      .set(bearer(player.accessToken))
      .send({ title: 'Nút Nhận thuê bị lẫn', message: 'Hai nút cạnh nhau dễ bấm nhầm.', type: 'BUG' })
      .expect(201);

    const closed = await http
      .patch(`${API}/admin/feedback/${posted.body.id}`)
      .set(bearer(moderator.accessToken))
      .send({ decision: 'APPROVED', adminNote: 'Đã đưa vào hàng đợi sửa' })
      .expect(200);
    expect(closed.body.status).toBe('APPROVED');
  });

  it('audits a manual behaviour adjustment', async () => {
    const adjusted = await http
      .post(`${API}/admin/users/${playerId}/behavior`)
      .set(bearer(moderator.accessToken))
      .send({ points: -5, satisfaction: 0, note: 'Hủy hẹn sát giờ, đã xác minh chat' })
      .expect(200);
    expect(adjusted.body.userId).toBe(playerId);

    await http
      .post(`${API}/admin/users/${playerId}/behavior`)
      .set(bearer(moderator.accessToken))
      .send({ points: 1, satisfaction: 1 })
      .expect(400);
  });

  it('audits the whole catalog round trip and blocks non-super admins', async () => {
    const game = await http
      .post(`${API}/admin/games`)
      .set(bearer(superAdmin.accessToken))
      .send({ name: 'Audit Probe Game' })
      .expect(201);

    await http
      .patch(`${API}/admin/games/${game.body.id}`)
      .set(bearer(superAdmin.accessToken))
      .send({ displayName: 'Probe' })
      .expect(200);

    const rank = await http
      .post(`${API}/admin/games/${game.body.id}/ranks`)
      .set(bearer(superAdmin.accessToken))
      .send({ no: 1, name: 'Kim' })
      .expect(201);

    await http
      .patch(`${API}/admin/ranks/${rank.body.id}`)
      .set(bearer(superAdmin.accessToken))
      .send({ name: 'Bạch Kim' })
      .expect(200);

    await http
      .delete(`${API}/admin/ranks/${rank.body.id}`)
      .set(bearer(superAdmin.accessToken))
      .expect(204);

    await http
      .delete(`${API}/admin/games/${game.body.id}`)
      .set(bearer(superAdmin.accessToken))
      .expect(204);

    const denied = await http
      .post(`${API}/admin/games`)
      .set(bearer(moderator.accessToken))
      .send({ name: 'Audit Probe Denied' })
      .expect(403);
    expect(codeOf(denied)).toBe('admin_role_required');
  });

  it('writes an audit row only for the actions that actually happened', async () => {
    await http.get(`${API}/admin/users`).set(bearer(superAdmin.accessToken)).expect(200);

    const rows = await auditRows();
    const byAction = (action: string) => rows.filter((row) => row.action === action);

    expect(byAction('notification.broadcast')).toHaveLength(1);
    // Lock, unlock, the presence tweak, two tier moves and the two super-admin
    // lock writes. The privilege attempts this suite refused wrote nothing.
    expect(byAction('user.update')).toHaveLength(7);
    expect(rows.filter((row) => row.reason === 'Tự nâng quyền')).toHaveLength(0);
    expect(rows.filter((row) => row.reason === 'Kết nạp quản trị viên')).toHaveLength(0);
    expect(byAction('config.create')).toHaveLength(1);
    expect(byAction('config.delete')).toHaveLength(1);
    expect(byAction('catalog.game_type_create')).toHaveLength(1);
    expect(byAction('catalog.game_type_delete')).toHaveLength(1);
    expect(byAction('withdrawal.resolve')).toHaveLength(1);
    expect(byAction('charity.payout_resolve')).toHaveLength(1);
    expect(byAction('feedback.resolve')).toHaveLength(1);
    expect(byAction('user.behavior_adjust')).toHaveLength(1);
    expect(byAction('system.maintenance')).toHaveLength(1);
    expect(byAction('config.update')).toHaveLength(1);
    for (const action of [
      'catalog.game_create',
      'catalog.game_update',
      'catalog.game_delete',
      'catalog.rank_create',
      'catalog.rank_update',
      'catalog.rank_delete',
    ]) {
      expect(byAction(action)).toHaveLength(1);
    }

    for (const row of rows) {
      expect(row.adminId).toBeTruthy();
      expect(['SUPER_ADMIN', 'MODERATOR', 'FINANCE']).toContain(row.adminRole);
    }

    const broadcast = byAction('notification.broadcast')[0];
    expect(broadcast.reason).toBe('Thông báo lịch định kỳ');
    expect(broadcast.adminRole).toBe('MODERATOR');
    expect(broadcast.detail).toMatchObject({ recipients: expect.any(Number) });

    expect(byAction('config.delete')[0].reason).toBe(CONFIG_DELETE_REASON);
    expect(byAction('config.create')[0].adminRole).toBe('FINANCE');

    const lock = byAction('user.update').find((row) => row.reason === 'Khảo thí nhiều tài khoản');
    expect(lock?.detail).toMatchObject({ before: { isActive: true }, after: { isActive: false } });

    const payout = byAction('withdrawal.resolve')[0];
    expect(payout.adminRole).toBe('FINANCE');
    expect(payout.reason).toBe('Chuyển khoản MCV-TEST-0001');
    expect(payout.detail).toMatchObject({ decision: 'PAID', amount: 50_000 });

    const charityPayout = byAction('charity.payout_resolve')[0];
    expect(charityPayout.adminRole).toBe('FINANCE');
    expect(charityPayout.reason).toBe('Thiếu số tài khoản nhận');
    expect(charityPayout.detail).toMatchObject({ before: 'PENDING', after: 'REJECTED', amount: 20_000 });

    const feedback = byAction('feedback.resolve')[0];
    expect(feedback.adminRole).toBe('MODERATOR');
    expect(feedback.reason).toBe('Đã đưa vào hàng đợi sửa');
    expect(feedback.detail).toMatchObject({ decision: 'APPROVED' });

    const behavior = byAction('user.behavior_adjust')[0];
    expect(behavior.adminRole).toBe('MODERATOR');
    expect(behavior.reason).toBe('Hủy hẹn sát giờ, đã xác minh chat');
    expect(behavior.detail).toMatchObject({ points: -5 });

    // Flipping maintenance leaves one system row and the config row behind it.
    expect(byAction('system.maintenance')[0].adminRole).toBe('SUPER_ADMIN');
    expect(byAction('config.update')[0].detail).toMatchObject({ key: 'system.maintenance_mode' });

    // The refused demotion and the refused lock of the last super admin never
    // reached the transaction, so they left no trace behind.
    const changesOnSuperAdmin = byAction('user.update')
      .filter((row) => row.entityId === superAdmin.user.id)
      .map((row) => row.reason)
      .sort();
    expect(changesOnSuperAdmin).toEqual(
      ['Khoá để thử hàng đợi', 'Mở khoá lại tài khoản chính'].sort(),
    );
  });
});
