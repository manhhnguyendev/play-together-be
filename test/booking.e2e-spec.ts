import { eq } from 'drizzle-orm';
import request from 'supertest';
import { escrowHolds, orders, users } from '../src/db/schema';
import { BackgroundJobs } from '../src/modules/jobs/background-jobs.service';
import { createTestApp, TEST_DEMO_PASSWORD, type TestApp } from './app.helper';

const API = '/api/v2';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const MS_MINUTE = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;
/** Asia/Ho_Chi_Minh is UTC+7 with no DST, which is what APP_TIMEZONE is pinned to. */
const OFFSET_MS = 7 * MS_HOUR;
const WEEKDAY_NUMBER: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

type Authenticated = { accessToken: string; user: { id: string } };
type Slot = { startsAt: string; scheduledEndAt: string };
type OrderResponse = {
  id: string;
  status: string;
  startsAt: string | null;
  scheduledEndAt: string | null;
  escrowStatus: string;
  closeReason: string | null;
};
type AvailabilityWindow = { dayOfWeek: number; startMinute: number; endMinute: number };

async function login(http: ReturnType<typeof request>, email: string, password: string): Promise<Authenticated> {
  const response = await http.post(`${API}/auth/login`).send({ email, password }).expect(200);
  return response.body as Authenticated;
}

/** The weekday number and local date parts of `ahead` days from now. */
function localDay(ahead: number): { dayOfWeek: number; utcMidnight: number } {
  const probe = new Date(Date.now() + ahead * MS_DAY);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(probe);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    dayOfWeek: WEEKDAY_NUMBER[read('weekday')],
    utcMidnight: Date.UTC(Number(read('year')), Number(read('month')) - 1, Number(read('day'))) - OFFSET_MS,
  };
}

const coversMinute = (windows: AvailabilityWindow[], dayOfWeek: number, minute: number): boolean =>
  windows.some(
    (window) => window.dayOfWeek === dayOfWeek && minute >= window.startMinute && minute + 60 <= window.endMinute,
  );

/**
 * Every hour-long slot inside the published windows that still lies ahead of
 * now, oldest first. Tests take them in order so no two of them collide.
 */
function coveredSlots(windows: AvailabilityWindow[]): Slot[] {
  const slots: Slot[] = [];
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const { dayOfWeek, utcMidnight } = localDay(ahead);
    for (let hour = 0; hour < 24; hour += 1) {
      if (!coversMinute(windows, dayOfWeek, hour * 60)) continue;
      const start = utcMidnight + hour * MS_HOUR;
      if (start <= Date.now()) continue;
      slots.push({ startsAt: new Date(start).toISOString(), scheduledEndAt: new Date(start + MS_HOUR).toISOString() });
    }
  }
  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** The first hour-long slot that is *not* covered, used to prove rejection. */
function uncoveredSlot(windows: AvailabilityWindow[]): Slot {
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const { dayOfWeek, utcMidnight } = localDay(ahead);
    for (let hour = 0; hour < 24; hour += 1) {
      if (coversMinute(windows, dayOfWeek, hour * 60)) continue;
      const start = utcMidnight + hour * MS_HOUR;
      if (start <= Date.now()) continue;
      return { startsAt: new Date(start).toISOString(), scheduledEndAt: new Date(start + MS_HOUR).toISOString() };
    }
  }
  throw new Error('the seeded player publishes every hour of every day');
}

/**
 * Booking a session. `availability_windows` used to be read by three mobile
 * screens and by nothing that mattered: `orders.startsAt` was the moment the
 * player hit accept, so a player could publish hours, a hirer could see them,
 * and neither changed when a session could actually run (audit §7.3).
 */
describe('Session booking (e2e)', () => {
  let harness: TestApp;
  let http: ReturnType<typeof request>;
  let jobs: BackgroundJobs;
  let hirer: Authenticated;
  let player: Authenticated;
  let admin: Authenticated;
  let arenaOfValorId: string;

  let slots: Slot[] = [];
  let taken = 0;
  const nextSlot = (): Slot => {
    const slot = slots[taken];
    if (!slot) throw new Error('the test ran out of published slots; give the seed wider hours');
    taken += 1;
    return slot;
  };

  const orderRow = async (orderId: string) => {
    const [row] = await harness.db.select().from(orders).where(eq(orders.id, orderId));
    return row;
  };

  const presence = async (): Promise<string> => {
    const profile = await http
      .get(`${API}/users/${player.user.id}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    return profile.body.status as string;
  };

  const book = async (slot: Slot, message: string): Promise<OrderResponse> =>
    (
      await http
        .post(`${API}/orders`)
        .set(bearer(hirer.accessToken))
        .send({ playerId: player.user.id, hours: 1, message, gameIds: [arenaOfValorId], startsAt: slot.startsAt })
        .expect(201)
    ).body as OrderResponse;

  const accept = (orderId: string) =>
    http.post(`${API}/orders/${orderId}/accept`).set(bearer(player.accessToken));

  beforeAll(async () => {
    harness = await createTestApp();
    await harness.seed();
    http = request(harness.app.getHttpServer());
    jobs = harness.app.get(BackgroundJobs);

    hirer = await login(http, 'demo.hirer1@playtogether.local', TEST_DEMO_PASSWORD);
    player = await login(http, 'demo.player1@playtogether.local', TEST_DEMO_PASSWORD);
    admin = await login(http, 'admin@playtogether.local', 'Admin@12345');

    const games = await http.get(`${API}/games?pageSize=100`).expect(200);
    arenaOfValorId = games.body.items.find((item: { name: string }) => item.name === 'Arena of Valor').id;

    const windows = (await http
      .get(`${API}/users/${player.user.id}/availability`)
      .expect(200))
      .body as AvailabilityWindow[];
    slots = coveredSlots(windows);
  });

  afterAll(async () => {
    await harness.app.close();
  });

  it('echoes the booked slot back and reserves nothing yet', async () => {
    const slot = nextSlot();
    const created = await book(slot, 'Booked session, please.');

    expect(created.status).toBe('PROPOSED');
    expect(created.startsAt).toBe(slot.startsAt);
    expect(created.scheduledEndAt).toBe(slot.scheduledEndAt);
    expect(created.escrowStatus).toBe('NONE');
  });

  it('tells the player about the request in Vietnamese, with a readable time', async () => {
    const slot = nextSlot();
    const created = await book(slot, 'Please write in the app language.');

    const page = await http
      .get(`${API}/notifications?pageSize=20`)
      .set(bearer(player.accessToken))
      .expect(200);
    const mine = (page.body.items as Array<{ title: string; body: string; referenceUrl: string | null }>).find(
      (item) => item.referenceUrl === `/orders/${created.id}`,
    );

    expect(mine?.title).toBe('Yêu cầu thuê mới');
    // The body used to interpolate `startsAt.toISOString()`, which put
    // `2026-11-02T11:00:00.000Z` on screen.
    expect(mine?.body).toMatch(/ vào lúc \d{2}:\d{2} \d{2}\/\d{2}\/\d{4}\.$/);
    expect(mine?.body).not.toMatch(/\dT\d{2}:\d{2}/);
  });

  it('moves a request onto the calendar when the player accepts', async () => {
    const slot = nextSlot();
    const created = await book(slot, 'A second booked session.');

    const accepted = await accept(created.id).expect(200);
    expect(accepted.body.status).toBe('SCHEDULED');
    expect(accepted.body.startsAt).toBe(slot.startsAt);
    expect(accepted.body.escrowStatus).toBe('HELD');

    const [hold] = await harness.db.select().from(escrowHolds).where(eq(escrowHolds.orderId, created.id));
    expect(hold.status).toBe('HELD');
    expect(hold.settledAmount).toBe(0);

    // The session has not begun, so the player must not be marked busy for it.
    expect(await presence()).not.toBe('BUSY');
  });

  it('starts the session on its own, when the clock reaches the slot', async () => {
    const created = await book(nextSlot(), 'This one is about to start.');
    await accept(created.id).expect(200);

    // Nothing is due yet: a scheduler that started bookings early would double
    // the player's calendar.
    expect((await jobs.runOnce()).started).toBe(0);
    expect((await orderRow(created.id)).status).toBe('SCHEDULED');

    await harness.db
      .update(orders)
      .set({ startsAt: new Date(Date.now() - MS_MINUTE), scheduledEndAt: new Date(Date.now() + 5 * MS_MINUTE) })
      .where(eq(orders.id, created.id));

    expect((await jobs.runOnce()).started).toBe(1);

    const running = await http.get(`${API}/orders/${created.id}`).set(bearer(hirer.accessToken)).expect(200);
    expect(running.body.status).toBe('LIVE');
    expect(await presence()).toBe('BUSY');
  });

  it('refuses a slot outside the hours the player publishes', async () => {
    const windows = (await http.get(`${API}/users/${player.user.id}/availability`).expect(200))
      .body as AvailabilityWindow[];
    const outside = uncoveredSlot(windows);

    const response = await http
      .post(`${API}/orders`)
      .set(bearer(hirer.accessToken))
      .send({ playerId: player.user.id, hours: 1, message: 'This hour is not published.', gameIds: [arenaOfValorId], startsAt: outside.startsAt })
      .expect(422);

    expect(response.body.code).toBe('slot_outside_availability');
  });

  it('refuses a booked slot whose time has already gone by', async () => {
    const created = await book(nextSlot(), 'Going to be stale.');
    await harness.db
      .update(orders)
      .set({ startsAt: new Date(Date.now() - MS_HOUR) })
      .where(eq(orders.id, created.id));

    const response = await accept(created.id).expect(409);
    expect(response.body.code).toBe('slot_conflict');

    // A rejected accept must not leave a ghost booking behind.
    expect((await orderRow(created.id)).status).toBe('PROPOSED');
  });

  it('gives the slot back when the hirer cancels the booking', async () => {
    const slot = nextSlot();
    const created = await book(slot, 'Cancelled before it starts.');
    await accept(created.id).expect(200);

    const cancelled = await http
      .post(`${API}/orders/${created.id}/cancel`)
      .set(bearer(hirer.accessToken))
      .send({ reason: 'Đổi lịch đột xuất' })
      .expect(200);
    expect(cancelled.body.status).toBe('CLOSED');
    expect(cancelled.body.closeReason).toBe('CANCELLED_BY_HIRER');
    // The mobile dialog asks for a reason, so it has to survive somewhere.
    expect(cancelled.body.reason).toBe('Đổi lịch đột xuất');

    const [hold] = await harness.db.select().from(escrowHolds).where(eq(escrowHolds.orderId, created.id));
    expect(hold.status).toBe('REFUNDED');

    // Nothing was played out, so there is nothing to rate: the mobile app used
    // to open the rating form straight after this call and the server refused.
    expect(cancelled.body.canRate).toBe(false);
    const rating = await http
      .post(`${API}/orders/${created.id}/ratings`)
      .set(bearer(hirer.accessToken))
      .send({ rate: 5, comment: 'should not be possible' })
      .expect(409);
    expect(rating.body.code).toBe('invalid_order_state');

    // Handing the slot back is the whole point of cancelling a booking, so the
    // same hour has to be bookable again.
    const rebooked = await book(slot, 'Takes the freed slot.');
    expect((await accept(rebooked.id).expect(200)).body.status).toBe('SCHEDULED');
  });

  it('lets the first hirer to accept win a contested slot', async () => {
    const slot = nextSlot();
    const first = await book(slot, 'First request for this hour.');
    // A request reserves nothing, so the second one is still allowed in.
    const second = await book(slot, 'Second request for the same hour.');

    await accept(first.id).expect(200);

    const response = await accept(second.id).expect(409);
    expect(response.body.code).toBe('slot_conflict');
    expect((await orderRow(second.id)).status).toBe('PROPOSED');

    // Now that the slot is owned, a fresh request for it fails at the door
    // instead of dangling until it expires.
    const late = await http
      .post(`${API}/orders`)
      .set(bearer(hirer.accessToken))
      .send({ playerId: player.user.id, hours: 1, message: 'Too late for this hour.', gameIds: [arenaOfValorId], startsAt: slot.startsAt })
      .expect(409);
    expect(late.body.code).toBe('slot_conflict');
  });

  it('still books a player who is mid-session right now', async () => {
    // The old rule blocked anyone who was not ONLINE or OFFLINE, which threw
    // away the main benefit of a calendar: next Tuesday is free even while
    // tonight is not.
    await harness.db
      .update(users)
      .set({ status: 'BUSY' })
      .where(eq(users.id, player.user.id));
    expect(await presence()).toBe('BUSY');

    const future = await book(nextSlot(), 'Next time the player is free.');
    expect(future.status).toBe('PROPOSED');

    // An instant hire of the same player is still refused: that session would
    // start now, and now is occupied.
    const instant = await http
      .post(`${API}/orders`)
      .set(bearer(hirer.accessToken))
      .send({ playerId: player.user.id, hours: 1, message: 'Right now, please.', gameIds: [arenaOfValorId] })
      .expect(400);
    expect(instant.body.code).toBe('player_unavailable');
  });
});
