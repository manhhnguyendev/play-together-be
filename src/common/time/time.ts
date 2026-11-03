import { Injectable } from '@nestjs/common';

export const MS_MINUTE = 60_000;
export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;

@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MS_MINUTE);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * MS_HOUR);
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number;
};

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '0';

  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    hour: Number(read('hour')),
    minute: Number(read('minute')),
    second: Number(read('second')),
    dayOfWeek: WEEKDAY_INDEX[read('weekday')] ?? 1,
  };
}

export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - (date.getTime() - date.getUTCMilliseconds());
}

const pad2 = (value: number): string => value.toString().padStart(2, '0');

/**
 * User-facing date/time strings. Notification bodies are stored text shown
 * verbatim in the Vietnamese app, so they never carry an ISO instant.
 */
export function formatClockInZone(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function formatDateInZone(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  return `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}`;
}

export function formatDateTimeInZone(date: Date, timeZone: string): string {
  return `${formatClockInZone(date, timeZone)} ${formatDateInZone(date, timeZone)}`;
}

export function startOfDayInZone(date: Date, timeZone: string): Date {
  const parts = zonedParts(date, timeZone);
  const localMidnight = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0);
  return new Date(localMidnight - timeZoneOffsetMs(date, timeZone));
}

/**
 * Local first-of-month midnight that contains `date`, cut the same way
 * `startOfDayInZone` cuts a day, so both boundaries agree with each other.
 */
export function startOfMonthInZone(date: Date, timeZone: string): Date {
  const parts = zonedParts(date, timeZone);
  const localFirst = Date.UTC(parts.year, parts.month - 1, 1, 0, 0, 0, 0);
  return new Date(localFirst - timeZoneOffsetMs(date, timeZone));
}

/**
 * The local start of each of the `count` periods ending with the one that
 * contains `now`, oldest first.
 *
 * Each start is derived from a point *inside* its period rather than by
 * subtracting a fixed span from a boundary, because a period is not a fixed
 * number of milliseconds once a timezone observes DST. Months probe mid-month
 * so an offset change on a month boundary cannot pull the probe into the
 * neighbouring month.
 */
export function periodStartsInZone(
  now: Date,
  timeZone: string,
  granularity: 'day' | 'month',
  count: number,
): Date[] {
  const nowParts = zonedParts(now, timeZone);
  const starts: Date[] = [];

  for (let back = count - 1; back >= 0; back -= 1) {
    const probe =
      granularity === 'day'
        ? new Date(now.getTime() - back * MS_DAY)
        : new Date(Date.UTC(nowParts.year, nowParts.month - 1 - back, 15, 12, 0, 0));
    starts.push(
      granularity === 'day'
        ? startOfDayInZone(probe, timeZone)
        : startOfMonthInZone(probe, timeZone),
    );
  }

  return starts;
}

export function isWithinAvailability(
  date: Date,
  windows: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>,
  timeZone: string,
): boolean {
  const parts = zonedParts(date, timeZone);
  const minute = parts.hour * 60 + parts.minute;
  return windows.some(
    (window) =>
      window.dayOfWeek === parts.dayOfWeek && minute >= window.startMinute && minute < window.endMinute,
  );
}

export type AvailabilityWindow = { dayOfWeek: number; startMinute: number; endMinute: number };

/**
 * Whether a whole session fits inside the windows a player published.
 *
 * Each window belongs to a single local day and cannot cross midnight (the
 * table checks `start_minute < end_minute`), so a session is walked one local
 * day at a time and every segment must sit inside one window of that day. A
 * segment may not be stitched from two windows, because the overlap validation
 * in `users.service` means published windows never touch.
 */
export function isSlotCovered(
  start: Date,
  end: Date,
  windows: readonly AvailabilityWindow[],
  timeZone: string,
): boolean {
  let cursor = start;

  while (cursor.getTime() < end.getTime()) {
    const parts = zonedParts(cursor, timeZone);
    const minuteOfDay = parts.hour * 60 + parts.minute;

    // A calendar day of local midnight plus 24h. Timezones that observe DST
    // would make this a minute or two generous, which only ever makes the check
    // stricter; the app timezone (Asia/Ho_Chi_Minh) has no DST.
    const dayStart = startOfDayInZone(cursor, timeZone);
    const nextMidnight = new Date(dayStart.getTime() + MS_DAY);
    const segmentEnd = new Date(Math.min(end.getTime(), nextMidnight.getTime()));
    const segmentMinutes = (segmentEnd.getTime() - cursor.getTime()) / MS_MINUTE;

    const covered = windows.some(
      (window) =>
        window.dayOfWeek === parts.dayOfWeek &&
        minuteOfDay >= window.startMinute &&
        minuteOfDay + segmentMinutes <= window.endMinute,
    );
    if (!covered) return false;

    cursor = segmentEnd;
  }

  return true;
}
