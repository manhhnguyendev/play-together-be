import { zonedParts, type ZonedParts } from '../../common/time/time';

export type SessionGranularity = 'day' | 'month';

/** The only order columns the timeline needs, narrowed so the query stays honest. */
export interface FinishedSession {
  endedAt: Date;
  playerId: string;
  hirerId: string;
  hours: number;
  totalPrice: number;
  playerPayout: number | null;
}

export interface SessionBucket {
  /** Local period key: `2026-11-03` for a day, `2026-11` for a month. */
  bucket: string;
  startsAt: Date;
  playerSessions: number;
  playerHours: number;
  earned: number;
  hirerSessions: number;
  spent: number;
}

const pad2 = (value: number): string => value.toString().padStart(2, '0');

export const bucketLabel = (
  start: ZonedParts,
  granularity: SessionGranularity,
): string =>
  granularity === 'day'
    ? `${start.year}-${pad2(start.month)}-${pad2(start.day)}`
    : `${start.year}-${pad2(start.month)}`;

/**
 * One row per period the caller asked for, oldest first, in the app timezone.
 *
 * Empty periods are returned as zero rows on purpose: a chart that only receives
 * the days with activity cannot tell "nothing happened" from "we did not look",
 * and the app would have to re-derive the gaps it was handed none of.
 */
export function summariseSessions(
  sessions: readonly FinishedSession[],
  periodStarts: readonly Date[],
  timeZone: string,
  granularity: SessionGranularity,
  userId: string,
): SessionBucket[] {
  const buckets = periodStarts.map((startsAt) => ({
    bucket: bucketLabel(zonedParts(startsAt, timeZone), granularity),
    startsAt,
    playerSessions: 0,
    playerHours: 0,
    earned: 0,
    hirerSessions: 0,
    spent: 0,
  }));

  sessions.forEach((session) => {
    const target = bucketIndexFor(session.endedAt, periodStarts);
    if (target === null) return;
    const bucket = buckets[target];

    if (session.playerId === userId) {
      bucket.playerSessions += 1;
      bucket.playerHours += session.hours;
      // A finished session always carries its settlement; a null here would be a
      // row from before that column existed, and 0 is the only honest reading.
      bucket.earned += session.playerPayout ?? 0;
    }
    if (session.hirerId === userId) {
      bucket.hirerSessions += 1;
      bucket.spent += session.totalPrice;
    }
  });

  return buckets;
}

/**
 * Index of the period containing `endedAt`, or null when it predates the window.
 * Starts are ascending, so the answer is the last one at or before the instant —
 * which also means anything in the future lands in the newest period instead of
 * vanishing from a chart the user is reading right now.
 */
function bucketIndexFor(endedAt: Date, periodStarts: readonly Date[]): number | null {
  if (periodStarts.length === 0 || endedAt.getTime() < periodStarts[0].getTime()) return null;

  let index = 0;
  for (let candidate = 1; candidate < periodStarts.length; candidate += 1) {
    if (endedAt.getTime() >= periodStarts[candidate].getTime()) index = candidate;
  }
  return index;
}
