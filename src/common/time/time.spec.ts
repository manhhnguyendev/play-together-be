import { addHours, addMinutes, isWithinAvailability, MS_HOUR, MS_MINUTE, startOfDayInZone, zonedParts } from './time';

const HCM = 'Asia/Ho_Chi_Minh';

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

  it('checks weekly availability windows in local time', () => {
    const evening = [{ dayOfWeek: 4, startMinute: 18 * 60, endMinute: 23 * 60 }];
    expect(isWithinAvailability(new Date('2026-01-15T12:00:00.000Z'), evening, HCM)).toBe(true);
    expect(isWithinAvailability(new Date('2026-01-15T10:00:00.000Z'), evening, HCM)).toBe(false);
    expect(
      isWithinAvailability(new Date('2026-01-15T12:00:00.000Z'), [{ ...evening[0], dayOfWeek: 5 }], HCM),
    ).toBe(false);
  });
});
