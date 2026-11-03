import { periodStartsInZone, zonedParts } from '../../common/time/time';
import { bucketLabel, summariseSessions, type FinishedSession } from './session-stats';

const HCM = 'Asia/Ho_Chi_Minh';
const ME = 'user-me';
const OTHER = 'user-other';

/** Local days 14, 15 and 16 of January 2026, oldest first. */
const now = new Date('2026-01-16T02:00:00.000Z'); // 09:00 local, Friday
const dayStarts = periodStartsInZone(now, HCM, 'day', 3);

const session = (overrides: Partial<FinishedSession> = {}): FinishedSession => ({
  endedAt: new Date('2026-01-14T17:30:00.000Z'), // 00:30 local on the 15th
  playerId: ME,
  hirerId: OTHER,
  hours: 2,
  totalPrice: 200_000,
  playerPayout: 180_000,
  ...overrides,
});

const totals = (
  sessions: FinishedSession[],
  starts = dayStarts,
  granularity: 'day' | 'month' = 'day',
) => summariseSessions(sessions, starts, HCM, granularity, ME);

describe('summariseSessions', () => {
  it('returns one zero row per period so a quiet day is not mistaken for no data', () => {
    const buckets = totals([]);
    expect(buckets.map((bucket) => bucket.bucket)).toEqual([
      '2026-01-14',
      '2026-01-15',
      '2026-01-16',
    ]);
    buckets.forEach((bucket) => {
      expect(bucket).toEqual({
        bucket: bucket.bucket,
        startsAt: expect.any(Date),
        playerSessions: 0,
        playerHours: 0,
        earned: 0,
        hirerSessions: 0,
        spent: 0,
      });
    });
  });

  it('cuts buckets on local midnight, not on the UTC one', () => {
    const lateThursday = session({ endedAt: new Date('2026-01-14T16:59:00.000Z') }); // 23:59 local 14th
    const earlyFriday = session({ endedAt: new Date('2026-01-14T17:01:00.000Z') }); // 00:01 local 15th

    const buckets = totals([lateThursday, earlyFriday]);
    expect(buckets.map((bucket) => bucket.playerSessions)).toEqual([1, 1, 0]);
  });

  it('adds up what I earned as a player', () => {
    const buckets = totals([session(), session({ playerPayout: 90_000, hours: 1 })]);
    expect(buckets[1]).toMatchObject({
      bucket: '2026-01-15',
      playerSessions: 2,
      playerHours: 3,
      earned: 270_000,
      hirerSessions: 0,
      spent: 0,
    });
  });

  it('adds up what I paid as a hirer, separately from the player side', () => {
    const buckets = totals([session({ playerId: OTHER, hirerId: ME })]);
    expect(buckets[1]).toMatchObject({
      playerSessions: 0,
      playerHours: 0,
      earned: 0,
      hirerSessions: 1,
      spent: 200_000,
    });
  });

  it('still counts a finished session whose payout column is null', () => {
    const buckets = totals([session({ playerPayout: null })]);
    expect(buckets[1]).toMatchObject({ playerSessions: 1, earned: 0 });
  });

  it('drops activity that predates the window it was asked for', () => {
    const buckets = totals([session({ endedAt: new Date('2026-01-13T16:00:00.000Z') })]);
    expect(buckets.reduce((sum, bucket) => sum + bucket.playerSessions, 0)).toBe(0);
  });

  it('keeps an instant clocked ahead of the window in the newest period', () => {
    const buckets = totals([session({ endedAt: new Date('2026-01-17T00:00:00.000Z') })]);
    expect(buckets[2]).toMatchObject({ bucket: '2026-01-16', playerSessions: 1 });
  });

  it('labels a month window by month', () => {
    const starts = periodStartsInZone(now, HCM, 'month', 2);
    const buckets = totals([session({ endedAt: new Date('2026-01-02T03:00:00.000Z') })], starts, 'month');
    expect(buckets.map((bucket) => bucket.bucket)).toEqual(['2025-12', '2026-01']);
    expect(buckets[1].playerSessions).toBe(1);
  });
});

describe('bucketLabel', () => {
  it('pads single-digit months and days', () => {
    const parts = zonedParts(new Date('2026-02-05T02:00:00.000Z'), HCM);
    expect(bucketLabel(parts, 'day')).toBe('2026-02-05');
    expect(bucketLabel(parts, 'month')).toBe('2026-02');
  });
});
