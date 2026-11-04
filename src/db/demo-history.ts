import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { formatVnd, quoteEarlyEnd, rankingPointsOf, splitFee } from '../common/money/money';
import { formatDateTimeInZone } from '../common/time/time';
import type { AppDatabase } from './client';
import {
  behaviorPoints,
  CONFIG_KEYS,
  deposits,
  escrowHolds,
  ledgerEntries,
  notifications,
  orderGames,
  orders,
  orderStatusHistory,
  pendingCredits,
  ratings,
  systemConfigs,
  userSkills,
  users,
  wallets,
  type User,
} from './schema';

/**
 * Demo order history.
 *
 * The base seed created no orders at all, so every screen that reads real sessions — the
 * "Diễn biến phiên" chart, both dashboards, admin Orders and Money — showed one bar or an empty
 * table. This writes finished sessions across ten weeks using the same money shape
 * `wallet.service` produces: an escrow hold debiting the hirer at accept time, a settlement that
 * splits the earned amount into the player's pending credit plus the platform fee, and the pending
 * credit already released, so wallet balances, ledger rows and the earnings list agree.
 *
 * Each session also leaves the status hops and the push notifications its real events would have
 * sent, with the same Vietnamese copy, so the order timeline and the notification feed read as
 * usage rather than as rows dropped into a table.
 *
 * Driven by `SEED_DEMO_HISTORY`, not `SEED_DEMO_DATA`: the ten e2e suites seed with
 * `demoData: true` and assert against orders they create themselves, so handing them a backlog of
 * sessions would change what those tests see.
 */

const HISTORY_DAYS = 70;
const UPCOMING_DAYS = 2;
const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;

const addHours = (date: Date, hours: number): Date => new Date(date.getTime() + hours * MS_PER_HOUR);

const addMinutes = (date: Date, minutes: number): Date => new Date(date.getTime() + minutes * MS_PER_MINUTE);

const earlierOf = (left: Date, right: Date): Date => (left.getTime() <= right.getTime() ? left : right);

/** Deterministic, so two clones of this repo get the same demo numbers. */
function randomStream(seedValue: number): () => number {
  let state = seedValue;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HIRE_MESSAGES = [
  'Kèo này giúp mình lấy lại tinh thần nhé',
  'Mình mới chơi, chỉ mình cách lên tay với',
  'Đánh couple rank tối nay nha',
  'Cần một người cùng team cho ổn định',
  'Hôm nay mình trực khuya, chơi cùng nhé',
  'Guide mình bản đồ mới với',
];

const GOOD_COMMENTS = [
  'Chuyên nghiệp, đúng giờ, vui vẻ.',
  'Chỉ tận tình, mình lên hẳn mấy hạng.',
  'Game hay, nói chuyện dễ chịu, sẽ thuê lại.',
  'Rất ổn, đúng giờ hẹn.',
];

const SO_SO_COMMENTS = ['Hơi trễ chút nhưng chơi tốt.', 'Ổn, lần sau hẹn lại.'];

const BAD_COMMENTS = ['Trễ hẹn khá lâu so với giờ đã thống nhất.'];

export type DemoHistoryInput = {
  players: User[];
  hirers: User[];
  now: Date;
  timeZone: string;
};

export type DemoHistoryResult = {
  orders: number;
  ratings: number;
  deposits: number;
  notifications: number;
};

type Buffers = {
  orderRows: (typeof orders.$inferInsert)[];
  gameRows: { orderId: string; gameId: string }[];
  historyRows: (typeof orderStatusHistory.$inferInsert)[];
  holdRows: (typeof escrowHolds.$inferInsert)[];
  creditRows: (typeof pendingCredits.$inferInsert)[];
  ledgerRows: (typeof ledgerEntries.$inferInsert)[];
  ratingRows: (typeof ratings.$inferInsert)[];
  depositRows: (typeof deposits.$inferInsert)[];
  notificationRows: (typeof notifications.$inferInsert)[];
};

const pickFrom = <T>(list: T[], nextInt: (min: number, max: number) => number): T =>
  list[nextInt(0, list.length - 1)];

/** Wraps around in both directions, because the day offset runs into the future as well. */
function cycle<T>(list: T[], index: number): T {
  return list[((index % list.length) + list.length) % list.length];
}

const NOTHING_SEEDED: DemoHistoryResult = { orders: 0, ratings: 0, deposits: 0, notifications: 0 };

export async function ensureDemoHistory(db: AppDatabase, input: DemoHistoryInput): Promise<DemoHistoryResult> {
  const { players, hirers, now, timeZone } = input;
  if (players.length === 0 || hirers.length === 0) return NOTHING_SEEDED;

  // Refuses to run twice: ids are generated fresh, so a second pass would silently double the
  // demo backlog. Wipe the cluster first (`npm run db:reset`).
  const [existingOrders] = await db.select({ count: sql<number>`count(*)` }).from(orders);
  if (Number(existingOrders?.count ?? 0) > 0) return NOTHING_SEEDED;

  const feeBps = await readConfig(db, CONFIG_KEYS.platformFeeBps, 1_000);
  const responseMinutes = await readConfig(db, CONFIG_KEYS.orderResponseMinutes, 5);
  const releaseHours = await readConfig(db, CONFIG_KEYS.pendingReleaseHours, 6);
  const windowHours = await readConfig(db, CONFIG_KEYS.disputeWindowHours, 24);

  const demoUserIds = [...players.map((user) => user.id), ...hirers.map((user) => user.id)];
  const walletRows = await db
    .select({ id: wallets.id, userId: wallets.userId })
    .from(wallets)
    .where(inArray(wallets.userId, demoUserIds));
  const walletByUser = new Map(walletRows.map((row) => [row.userId, row.id]));

  const skillRows = await db
    .select({ userId: userSkills.userId, gameId: userSkills.gameId })
    .from(userSkills)
    .where(inArray(userSkills.userId, players.map((player) => player.id)));
  const gamesByPlayer = new Map<string, string[]>();
  for (const row of skillRows) {
    const list = gamesByPlayer.get(row.userId) ?? [];
    list.push(row.gameId);
    gamesByPlayer.set(row.userId, list);
  }
  const fallbackGame = skillRows[0]?.gameId;
  if (!fallbackGame) return NOTHING_SEEDED;

  const rand = randomStream(20261104);
  const nextInt = (min: number, max: number): number => min + Math.floor(rand() * (max - min + 1));
  const pick = <T>(list: T[]): T => list[nextInt(0, list.length - 1)];

  const buffers: Buffers = {
    orderRows: [],
    gameRows: [],
    historyRows: [],
    holdRows: [],
    creditRows: [],
    ledgerRows: [],
    ratingRows: [],
    depositRows: [],
    notificationRows: [],
  };

  /**
   * Balance while building, oldest session first, so no order is written that its hirer could not
   * have paid at that moment. Wallet rows are reconciled from the ledger at the end anyway.
   */
  const balance = new Map<string, number>(demoUserIds.map((userId) => [userId, 0]));

  const topUp = (hirer: User, amount: number, beforeHold: Date): void => {
    const walletId = walletByUser.get(hirer.id);
    if (!walletId) return;
    const id = randomUUID();
    const createdAt = addHours(beforeHold, -6);
    const completedAt = addHours(beforeHold, -5);
    buffers.depositRows.push({
      id,
      userId: hirer.id,
      walletId,
      amount,
      provider: 'MOMO',
      providerTxnId: `MOCK-${id}`,
      status: 'SUCCEEDED',
      createdAt,
      completedAt,
    });
    postLedgerGroup(buffers, [
      entry({ accountType: 'USER', accountId: hirer.id, walletId, direction: 'CREDIT', type: 'DEPOSIT', amount, note: 'Nạp tiền qua MoMo' }, completedAt),
      entry({ accountType: 'EXTERNAL', direction: 'DEBIT', type: 'DEPOSIT', amount, note: 'Nạp tiền qua MoMo' }, completedAt),
    ]);
    balance.set(hirer.id, (balance.get(hirer.id) ?? 0) + amount);
  };

  const today = new Date(now.getTime());
  today.setHours(0, 0, 0, 0);

  // Seventy days behind today carry the finished sessions; the two ahead keep an open request and a
  // booked session, so the calendar and the request queue are not empty for whoever signs in.
  for (let offset = HISTORY_DAYS; offset >= -UPCOMING_DAYS; offset -= 1) {
    // Today is left to the two sessions that just ended (below) and to the requests booked for the
    // days ahead: an evening slot placed on today's date would still be in the future whenever the
    // seed runs before it.
    if (offset === 0) continue;

    const dayStart = new Date(today.getTime() - offset * 24 * MS_PER_HOUR);
    const upcoming = offset < 0;

    for (let index = 0, sessions = nextInt(2, 3); index < sessions; index += 1) {
      const player = cycle(players, offset * 3 + index);
      const hirer = cycle(hirers, offset + index);
      if (!player || !hirer) continue;

      const needed = player.pricePerHour * 3;
      if ((balance.get(hirer.id) ?? 0) < needed) {
        topUp(hirer, 2_000_000, upcoming ? addHours(now, -2) : addHours(dayStart, 12));
      }

      buildSession(buffers, {
        player,
        hirer,
        walletByUser,
        balance,
        feeBps,
        responseMinutes,
        windowHours,
        releaseHours,
        timeZone,
        dayStart,
        now,
        upcomingDays: upcoming ? -offset : 0,
        outcome: upcoming ? (index === 0 ? 'PROPOSED' : 'SCHEDULED') : rand() < 0.1 ? 'ENDED_EARLY' : 'SETTLED',
        late: rand() < 0.15,
        hours: Math.min(nextInt(1, 3), Math.max(1, player.maxHoursPerHire ?? 1)),
        gameId: pick(gamesByPlayer.get(player.id) ?? [fallbackGame]),
        roll: rand(),
        nextInt,
      });
    }
  }

  // Two sessions that stopped a couple of hours ago. Their payouts are inside the release window,
  // so the player's "chờ về ví" screen and the release job have something real to work on.
  for (let index = 0; index < 2; index += 1) {
    const player = cycle(players, index + 1);
    const hirer = cycle(hirers, index);
    if (!player || !hirer) continue;
    const hours = Math.min(2, Math.max(1, player.maxHoursPerHire ?? 1));
    if ((balance.get(hirer.id) ?? 0) < player.pricePerHour * hours) topUp(hirer, 2_000_000, now);
    buildSession(buffers, {
      player,
      hirer,
      walletByUser,
      balance,
      feeBps,
      responseMinutes,
      windowHours,
      releaseHours,
      timeZone,
      dayStart: now,
      now,
      upcomingDays: 0,
      startsAtOverride: new Date(now.getTime() - (hours + 1) * MS_PER_HOUR),
      outcome: index === 1 ? 'ENDED_EARLY' : 'SETTLED',
      hours,
      gameId: pick(gamesByPlayer.get(player.id) ?? [fallbackGame]),
      roll: rand(),
      nextInt,
    });
  }

  if (buffers.orderRows.length === 0) return NOTHING_SEEDED;

  await db.insert(orders).values(buffers.orderRows);
  await db.insert(orderGames).values(buffers.gameRows);
  await db.insert(orderStatusHistory).values(buffers.historyRows);
  if (buffers.depositRows.length > 0) await db.insert(deposits).values(buffers.depositRows);
  await db.insert(ledgerEntries).values(buffers.ledgerRows);
  if (buffers.holdRows.length > 0) await db.insert(escrowHolds).values(buffers.holdRows);
  if (buffers.creditRows.length > 0) await db.insert(pendingCredits).values(buffers.creditRows);
  if (buffers.ratingRows.length > 0) await db.insert(ratings).values(buffers.ratingRows);
  await db.insert(notifications).values(buffers.notificationRows);

  await refreshPlayerStats(db, players);
  await reconcileWallets(db, demoUserIds, walletByUser, now);

  return {
    orders: buffers.orderRows.length,
    ratings: buffers.ratingRows.length,
    deposits: buffers.depositRows.length,
    notifications: buffers.notificationRows.length,
  };
}

type SessionPlan = {
  player: User;
  hirer: User;
  walletByUser: Map<string, string>;
  balance: Map<string, number>;
  feeBps: number;
  responseMinutes: number;
  windowHours: number;
  releaseHours: number;
  timeZone: string;
  dayStart: Date;
  now: Date;
  /** Used when the slot is anchored to the clock instead of to a calendar day. */
  startsAtOverride?: Date;
  /** Whole days the slot sits ahead of today; zero when the session is in the past. */
  upcomingDays: number;
  outcome: SessionOutcome;
  hours: number;
  gameId: string;
  roll: number;
  nextInt: (min: number, max: number) => number;
  late?: boolean;
};

type SessionOutcome = 'SETTLED' | 'ENDED_EARLY' | 'SCHEDULED' | 'PROPOSED';

/** One session, written the way the services write it: request, accept + hold, live, end, release. */
function buildSession(buffers: Buffers, plan: SessionPlan): void {
  const {
    player,
    hirer,
    hours,
    feeBps,
    responseMinutes,
    windowHours,
    releaseHours,
    dayStart,
    walletByUser,
    balance,
    now,
    timeZone,
  } = plan;
  const status = plan.outcome;
  const id = randomUUID();
  const hirerWallet = walletByUser.get(hirer.id);
  const playerWallet = walletByUser.get(player.id);

  /** Same copy `NotificationService.send` writes, with old notices already marked read. */
  const notify = (userId: string, title: string, body: string, at: Date): void => {
    const recent = at.getTime() > now.getTime() - 3 * 24 * MS_PER_HOUR;
    buffers.notificationRows.push({
      userId,
      title,
      body,
      referenceUrl: `/orders/${id}`,
      status: recent ? 'UNREAD' : 'READ',
      createdAt: at,
      readAt: recent ? null : earlierOf(addHours(at, plan.nextInt(1, 10)), now),
    });
  };

  // A past session keeps its evening slot; an upcoming one is placed later than today's clock, so
  // a booking never reads as a session that already ran out.
  const slotHour = plan.upcomingDays > 0 ? plan.upcomingDays * 24 + plan.nextInt(0, 18) : plan.nextInt(18, 21);
  const startsAt = plan.startsAtOverride ?? addHours(dayStart, slotHour);
  const scheduledEndAt = addHours(startsAt, hours);
  // An open request was made inside the reply window, which is minutes wide. A finished or
  // upcoming one is requested and accepted before its slot, and never on a timestamp the clock has
  // not reached yet — a session booked for tomorrow is still requested today.
  const requestedAt =
    status === 'PROPOSED'
      ? new Date(now.getTime() - plan.nextInt(1, Math.max(1, responseMinutes - 1)) * MS_PER_MINUTE)
      : earlierOf(addHours(startsAt, -24), addHours(now, -3));
  const respondedAt = earlierOf(addHours(startsAt, -20), addHours(now, -2));
  const totalPrice = hours * player.pricePerHour;

  buffers.orderRows.push({
    id,
    hirerId: hirer.id,
    playerId: player.id,
    status,
    hours,
    hourlyRate: player.pricePerHour,
    totalPrice,
    feeBps,
    playerPayout: null,
    message: HIRE_MESSAGES[plan.nextInt(0, HIRE_MESSAGES.length - 1)],
    reason: status === 'ENDED_EARLY' ? 'Hai bên thống nhất dừng sớm' : null,
    endedEarlyBy: status === 'ENDED_EARLY' ? 'HIRER' : null,
    respondBy: addMinutes(requestedAt, responseMinutes),
    startsAt: status === 'PROPOSED' ? null : startsAt,
    scheduledEndAt: status === 'PROPOSED' ? null : scheduledEndAt,
    endedAt: null,
    createdAt: requestedAt,
    updatedAt: status === 'PROPOSED' ? requestedAt : respondedAt,
  });
  buffers.gameRows.push({ orderId: id, gameId: plan.gameId });
  buffers.historyRows.push({
    orderId: id,
    fromStatus: null,
    toStatus: 'PROPOSED',
    actorId: hirer.id,
    reason: 'Tạo yêu cầu thuê',
    createdAt: requestedAt,
  });

  notify(
    player.id,
    'Yêu cầu thuê mới',
    `${hirer.name} muốn hẹn bạn ${hours} giờ vào lúc ${formatDateTimeInZone(startsAt, timeZone)}.`,
    requestedAt,
  );

  if (status === 'PROPOSED') return;

  buffers.historyRows.push({
    orderId: id,
    fromStatus: 'PROPOSED',
    toStatus: 'SCHEDULED',
    actorId: player.id,
    reason: `Đã hẹn lúc ${formatDateTimeInZone(startsAt, timeZone)} (${hours} giờ)`,
    createdAt: respondedAt,
  });
  notify(
    hirer.id,
    'Đã giữ lịch hẹn',
    `Lượt thuê của bạn bắt đầu lúc ${formatDateTimeInZone(startsAt, timeZone)}, kéo dài ${hours} giờ.`,
    respondedAt,
  );

  if (!hirerWallet || (balance.get(hirer.id) ?? 0) < totalPrice) return;
  balance.set(hirer.id, (balance.get(hirer.id) ?? 0) - totalPrice);

  postLedgerGroup(buffers, [
    entry({ accountType: 'USER', accountId: hirer.id, walletId: hirerWallet, orderId: id, direction: 'DEBIT', type: 'ESCROW_HOLD', amount: totalPrice, note: 'Tạm giữ tiền cho đơn thuê' }, respondedAt),
    entry({ accountType: 'ESCROW', accountId: id, orderId: id, direction: 'CREDIT', type: 'ESCROW_HOLD', amount: totalPrice, note: 'Tạm giữ tiền cho đơn thuê' }, respondedAt),
  ]);
  buffers.holdRows.push({
    orderId: id,
    hirerWalletId: hirerWallet,
    amount: totalPrice,
    status: 'HELD',
    createdAt: respondedAt,
    updatedAt: respondedAt,
  });

  if (status === 'SCHEDULED') return;

  const bookedMs = hours * MS_PER_HOUR;
  // The session clock stops at the booked end; a cut-short session stops inside its slot, which is
  // what makes the pro-rated refund and the recorded end time describe the same moment.
  const endedAt =
    status === 'ENDED_EARLY'
      ? new Date(startsAt.getTime() + Math.round(bookedMs * 0.7))
      : scheduledEndAt;
  // `openDisputeWindow` closes the session, then either a participant taps complete or the
  // objection window runs out. Tapping is the common case, so money settles shortly after the end.
  const settledAt =
    status === 'ENDED_EARLY'
      ? endedAt
      : earlierOf(addMinutes(endedAt, plan.nextInt(5, 180)), now);

  const quote =
    status === 'ENDED_EARLY'
      ? quoteEarlyEnd(totalPrice, endedAt.getTime() - startsAt.getTime(), bookedMs)
      : null;
  const earned = quote?.earned ?? totalPrice;
  const refund = quote?.refund ?? 0;
  const { fee, payout } = splitFee(earned, feeBps);

  buffers.historyRows.push({
    orderId: id,
    fromStatus: 'SCHEDULED',
    toStatus: 'LIVE',
    actorId: null,
    reason: 'Lịch hẹn tự động bắt đầu đúng giờ đã đặt',
    createdAt: startsAt,
  });
  notify(hirer.id, 'Lượt thuê đã bắt đầu', `Buổi hẹn đã bắt đầu, kéo dài ${hours} giờ.`, startsAt);
  notify(player.id, 'Lượt thuê đã bắt đầu', 'Buổi hẹn của bạn đã bắt đầu.', startsAt);
  if (status === 'SETTLED') {
    buffers.historyRows.push({
      orderId: id,
      fromStatus: 'LIVE',
      toStatus: 'DISPUTED',
      actorId: null,
      reason: 'Cuộc hẹn kết thúc theo lịch; tiền đang chờ đối soát',
      createdAt: endedAt,
    });
    notify(
      hirer.id,
      'Xác nhận lượt thuê',
      windowHours > 0
        ? `Lượt thuê đã kết thúc. Tiền của bạn sẽ tự động chuyển cho người chơi sau ${windowHours} giờ — bấm Hoàn thành để chuyển ngay, hoặc Báo cáo nếu có vấn đề.`
        : 'Lượt thuê đã kết thúc và tiền đang được chuyển cho người chơi. Hãy Báo cáo nếu có vấn đề.',
      endedAt,
    );
    notify(
      player.id,
      'Lượt thuê đã kết thúc',
      windowHours > 0
        ? `Bạn nhận được tiền khi người thuê xác nhận hoặc sau ${windowHours} giờ.`
        : 'Thu nhập của bạn đang được giải ngân.',
      endedAt,
    );
  }
  buffers.historyRows.push({
    orderId: id,
    fromStatus: status === 'SETTLED' ? 'DISPUTED' : 'LIVE',
    toStatus: status,
    actorId: status === 'SETTLED' && plan.roll > 0.25 ? hirer.id : null,
    reason:
      status === 'ENDED_EARLY'
        ? `Kết thúc sớm sau ${quote?.tenths ?? 0}/10 thời lượng`
        : plan.roll > 0.25
          ? 'Người tham gia xác nhận hoàn thành'
          : 'Hết thời gian khiếu nại mà không có báo cáo',
    createdAt: settledAt,
  });
  if (status === 'ENDED_EARLY') {
    notify(hirer.id, 'Lượt thuê kết thúc sớm', `Lượt thuê kết thúc sớm. Bạn đã được hoàn ${formatVnd(refund)} vào ví.`, settledAt);
    notify(player.id, 'Lượt thuê kết thúc sớm', 'Lượt thuê kết thúc sớm. Thu nhập của bạn đang chờ được giải ngân.', settledAt);
  } else {
    notify(hirer.id, 'Lượt thuê hoàn thành', 'Lượt thuê đã hoàn thành. Hãy đánh giá để giúp cộng đồng.', settledAt);
    notify(player.id, 'Lượt thuê hoàn thành', 'Thu nhập đang chờ và sẽ khả dụng trong ít phút.', settledAt);
  }

  const hold = buffers.holdRows.find((row) => row.orderId === id);
  if (hold) {
    hold.status = refund > 0 ? 'PARTIALLY_SETTLED' : 'SETTLED';
    hold.settledAmount = earned;
    hold.refundedAmount = refund;
    hold.updatedAt = settledAt;
  }

  const order = buffers.orderRows.find((row) => row.id === id);
  if (order) {
    order.playerPayout = payout;
    order.endedAt = endedAt;
    order.disputedAt = status === 'SETTLED' ? endedAt : null;
    order.updatedAt = settledAt;
  }

  if (refund > 0) {
    balance.set(hirer.id, (balance.get(hirer.id) ?? 0) + refund);
    postLedgerGroup(buffers, [
      entry({ accountType: 'ESCROW', accountId: id, orderId: id, direction: 'DEBIT', type: 'ESCROW_REFUND', amount: refund, note: 'Hoàn phần tiền thuê chưa dùng cho người thuê' }, settledAt),
      entry({ accountType: 'USER', accountId: hirer.id, walletId: hirerWallet, orderId: id, direction: 'CREDIT', type: 'ESCROW_REFUND', amount: refund, note: 'Hoàn phần tiền thuê chưa dùng cho người thuê' }, settledAt),
    ]);
  }

  if (earned > 0 && playerWallet) {
    postLedgerGroup(buffers, [
      entry({ accountType: 'ESCROW', accountId: id, orderId: id, direction: 'DEBIT', type: 'ESCROW_RELEASE', amount: earned, note: 'Giải ngân tiền đơn thuê' }, settledAt),
      entry({ accountType: 'USER', accountId: player.id, walletId: playerWallet, orderId: id, direction: 'CREDIT', type: 'ORDER_EARNING', amount: payout, note: 'Doanh thu đơn thuê (chờ về ví)' }, settledAt),
      ...(fee > 0 ? [entry({ accountType: 'PLATFORM' as const, orderId: id, direction: 'CREDIT' as const, type: 'PLATFORM_FEE' as const, amount: fee, note: 'Phí nền tảng' }, settledAt)] : []),
    ]);
    // The earning is posted at settlement but only lands in the wallet when its release is due,
    // so the newest sessions leave real money on the "chờ về ví" screen for the scheduler to pick up.
    const availableAt = addHours(settledAt, releaseHours);
    buffers.creditRows.push({
      walletId: playerWallet,
      orderId: id,
      amount: payout,
      availableAt,
      releasedAt: availableAt.getTime() <= now.getTime() ? availableAt : null,
      createdAt: settledAt,
    });
    balance.set(player.id, (balance.get(player.id) ?? 0) + payout);
  }

  if (plan.roll < 0.75) {
    const score = plan.late || status === 'ENDED_EARLY' ? plan.nextInt(2, 4) : plan.nextInt(4, 5);
    buffers.ratingRows.push({
      orderId: id,
      raterId: hirer.id,
      rateeId: player.id,
      rate: score,
      comment:
        score >= 4
          ? pickFrom(GOOD_COMMENTS, plan.nextInt)
          : score === 3
            ? pickFrom(SO_SO_COMMENTS, plan.nextInt)
            : pickFrom(BAD_COMMENTS, plan.nextInt),
      isActive: true,
      createdAt: earlierOf(addHours(settledAt, plan.nextInt(1, 12)), addMinutes(now, -30)),
    });
  }
  if (plan.roll > 0.6 && playerWallet) {
    buffers.ratingRows.push({
      orderId: id,
      raterId: player.id,
      rateeId: hirer.id,
      rate: 5,
      comment: pickFrom(GOOD_COMMENTS, plan.nextInt),
      isActive: true,
      createdAt: earlierOf(addHours(settledAt, plan.nextInt(2, 20)), addMinutes(now, -30)),
    });
  }
}

type LedgerDraft = {
  accountType: 'USER' | 'CHARITY' | 'PLATFORM' | 'ESCROW' | 'EXTERNAL';
  accountId?: string | null;
  walletId?: string | null;
  orderId?: string | null;
  direction: 'CREDIT' | 'DEBIT';
  type: typeof ledgerEntries.$inferInsert.type;
  amount: number;
  note: string;
};

function entry(draft: LedgerDraft, createdAt: Date): (typeof ledgerEntries.$inferInsert) {
  return {
    transactionId: '',
    accountType: draft.accountType,
    accountId: draft.accountId ?? null,
    walletId: draft.walletId ?? null,
    charityId: null,
    orderId: draft.orderId ?? null,
    direction: draft.direction,
    type: draft.type,
    amount: draft.amount,
    note: draft.note,
    createdAt,
  };
}

/** One balanced group of rows under a single transaction id, like `WalletService.post`. */
function postLedgerGroup(buffers: Buffers, entries: (typeof ledgerEntries.$inferInsert)[]): void {
  const transactionId = randomUUID();
  for (const row of entries) buffers.ledgerRows.push({ ...row, transactionId });
}

/** Mirrors `StatsService.recompute` so the stored profile counters match the stats screen. */
async function refreshPlayerStats(db: AppDatabase, players: User[]): Promise<void> {
  for (const player of players) {
    const [ratingAgg] = await db
      .select({
        sum: sql<number>`coalesce(sum(${ratings.rate}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(ratings)
      .where(and(eq(ratings.rateeId, player.id), eq(ratings.isActive, true)));

    const [orderAgg] = await db
      .select({
        total: sql<number>`count(*)`,
        completed: sql<number>`count(*) filter (where ${orders.status} in ('SETTLED', 'ENDED_EARLY'))`,
        onTime: sql<number>`count(*) filter (where ${orders.status} = 'SETTLED'
          and ${orders.scheduledEndAt} is not null
          and ${orders.endedAt} is not null
          and ${orders.endedAt} <= ${orders.scheduledEndAt})`,
        hours: sql<number>`coalesce(sum(${orders.hours}) filter (where ${orders.status} in ('SETTLED', 'ENDED_EARLY')), 0)`,
      })
      .from(orders)
      .where(eq(orders.playerId, player.id));

    const [behavior] = await db
      .select({ points: behaviorPoints.points })
      .from(behaviorPoints)
      .where(eq(behaviorPoints.userId, player.id))
      .limit(1);

    const stats = {
      ratingSum: Number(ratingAgg?.sum ?? 0),
      ratingCount: Number(ratingAgg?.count ?? 0),
      ordersCount: Number(orderAgg?.total ?? 0),
      completedOrdersCount: Number(orderAgg?.completed ?? 0),
      totalHours: Number(orderAgg?.hours ?? 0),
      onTimeCount: Number(orderAgg?.onTime ?? 0),
    };

    await db
      .update(users)
      .set({
        ...stats,
        rankingPoints: rankingPointsOf({
          ratingSum: stats.ratingSum,
          ratingCount: stats.ratingCount,
          completedOrders: stats.completedOrdersCount,
          onTimeCount: stats.onTimeCount,
          behaviorPoints: behavior?.points ?? 100,
        }),
      })
      .where(eq(users.id, player.id));
  }
}

/**
 * A wallet's available money is its ledger minus whatever is still pending, which is exactly how
 * `releaseDuePendingCredits` moves it: the credit row is posted at settlement, the balance only
 * grows at release. Writing history by hand makes drift easy, so derive the number instead.
 */
async function reconcileWallets(
  db: AppDatabase,
  userIds: string[],
  walletByUser: Map<string, string>,
  now: Date,
): Promise<void> {
  for (const userId of userIds) {
    const walletId = walletByUser.get(userId);
    if (!walletId) continue;

    const [movement] = await db
      .select({
        net: sql<number>`coalesce(sum(case when ${ledgerEntries.direction} = 'CREDIT' then ${ledgerEntries.amount} else -${ledgerEntries.amount} end), 0)`,
      })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.walletId, walletId), eq(ledgerEntries.accountType, 'USER')));

    const [pending] = await db
      .select({ total: sql<number>`coalesce(sum(${pendingCredits.amount}), 0)` })
      .from(pendingCredits)
      .where(and(eq(pendingCredits.walletId, walletId), isNull(pendingCredits.releasedAt)));

    await db
      .update(wallets)
      .set({ availableBalance: Math.max(0, Number(movement?.net ?? 0) - Number(pending?.total ?? 0)), updatedAt: now })
      .where(eq(wallets.id, walletId));
  }
}

async function readConfig(db: AppDatabase, key: string, fallback: number): Promise<number> {
  const [row] = await db
    .select({ value: systemConfigs.value })
    .from(systemConfigs)
    .where(eq(systemConfigs.key, key))
    .limit(1);
  return row?.value ?? fallback;
}
