import {
  addHours,
  addMinutes,
  formatClockInZone,
  formatDateInZone,
  formatDateTimeInZone,
  isWithinAvailability,
  MS_HOUR,
  MS_MINUTE,
  periodStartsInZone,
  startOfDayInZone,
  startOfMonthInZone,
  zonedParts,
} from './time';

const HCM = 'Asia/Ho_Chi_Minh';

const toIso = (date: Date): string => date.toISOString();

describe('time helpers', () => {
  it('adds minutes and hours without mutating the input', () => {
    const base = new Date('2026-01-15T00:00:00.000Z');
    expect(addMinutes(base, 30).toISOString()).toBe('2026-01-15T00:30:00.000Z');
    expect(addHours(base, 2).toISOString()).toBe('2026-01-15T02:00:00.000Z');
    expect(base.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(MS_MINUTE * 60).toBe(MS_HOUR);
  });

  it('reads wall-clock parts in the configured timezone', () => {
    expect(zonedParts(new Date('2026-01-15T00:00:00.000Z'), HCM)).toEqual({
      year: 2026,
      month: 1,
      day: 15,
      hour: 7,
      minute: 0,
      second: 0,
      dayOfWeek: 4,
    });
  });

  it('finds local midnight across the UTC offset', () => {
    expect(startOfDayInZone(new Date('2026-01-15T12:00:00.000Z'), HCM).toISOString()).toBe(
      '2026-01-14T17:00:00.000Z',
    );
  });

  it('finds local first-of-month midnight', () => {
    expect(startOfMonthInZone(new Date('2026-01-15T12:00:00.000Z'), HCM).toISOString()).toBe(
      '2025-12-31T17:00:00.000Z',
    );
    // Standing two hours into the local February still names February.
    expect(startOfMonthInZone(new Date('2026-01-31T20:00:00.000Z'), HCM).toISOString()).toBe(
      '2026-01-31T17:00:00.000Z',
    );
  });

  describe('periodStartsInZone', () => {
    it('walks whole local days back, oldest first', () => {
      const now = new Date('2026-01-15T12:00:00.000Z'); // 19:00 Thu, local
      expect(periodStartsInZone(now, HCM, 'day', 3).map(toIso)).toEqual([
        '2026-01-12T17:00:00.000Z',
        '2026-01-13T17:00:00.000Z',
        '2026-01-14T17:00:00.000Z',
      ]);
    });

    it('counts the period the clock is standing in as the newest one', () => {
      const midnightSharp = new Date('2026-01-14T17:00:00.000Z'); // 00:00 Fri, local
      expect(periodStartsInZone(midnightSharp, HCM, 'day', 2).map(toIso)).toEqual([
        '2026-01-13T17:00:00.000Z',
        '2026-01-14T17:00:00.000Z',
      ]);
    });

    it('walks whole local months back', () => {
      const now = new Date('2026-01-15T12:00:00.000Z');
      expect(periodStartsInZone(now, HCM, 'month', 3).map(toIso)).toEqual([
        '2025-10-31T17:00:00.000Z',
        '2025-11-30T17:00:00.000Z',
        '2025-12-31T17:00:00.000Z',
      ]);
    });

    it('does not skip a month when the window crosses a year boundary', () => {
      const january = new Date('2026-01-05T02:00:00.000Z'); // 09:00 local, Jan
      expect(periodStartsInZone(january, HCM, 'month', 3).map(toIso)).toEqual([
        '2025-10-31T17:00:00.000Z',
        '2025-11-30T17:00:00.000Z',
        '2025-12-31T17:00:00.000Z',
      ]);
    });
  });

  it('checks weekly availability windows in local time', () => {
    const evening = [{ dayOfWeek: 4, startMinute: 18 * 60, endMinute: 23 * 60 }];
    expect(isWithinAvailability(new Date('2026-01-15T12:00:00.000Z'), evening, HCM)).toBe(true);
    expect(isWithinAvailability(new Date('2026-01-15T10:00:00.000Z'), evening, HCM)).toBe(false);
    expect(
      isWithinAvailability(new Date('2026-01-15T12:00:00.000Z'), [{ ...evening[0], dayOfWeek: 5 }], HCM),
    ).toBe(false);
  });
});

describe('user-facing date formats', () => {
  it('renders the instant as local clock and day/month/year', () => {
    // 11:00 UTC is 18:00 in Ho Chi Minh City, the same calendar day.
    expect(formatDateTimeInZone(new Date('2026-11-02T11:00:00.000Z'), HCM)).toBe('18:00 02/11/2026');
    expect(formatClockInZone(new Date('2026-11-02T11:05:00.000Z'), HCM)).toBe('18:05');
    expect(formatDateInZone(new Date('2026-11-02T11:00:00.000Z'), HCM)).toBe('02/11/2026');
  });

  it('rolls the date over when the offset crosses midnight', () => {
    // 17:00 UTC is already the next day locally (00:00 on the 3rd).
    expect(formatDateTimeInZone(new Date('2026-11-02T17:00:00.000Z'), HCM)).toBe('00:00 03/11/2026');
  });
});
