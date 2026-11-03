import { canRateOrder, ratingBlock, ratingBlockedError } from './rating-eligibility';

const NOW = new Date('2026-11-04T09:00:00.000Z');
const HOUR = 3_600_000;

const input = (over: Partial<Parameters<typeof ratingBlock>[0]> = {}) => ({
  status: 'SETTLED',
  endedAt: new Date(NOW.getTime() - HOUR),
  scheduledEndAt: new Date(NOW.getTime() - 2 * HOUR),
  windowHours: 24,
  now: NOW,
  participant: true,
  ratedByViewer: false,
  reportedByViewer: false,
  ...over,
});

describe('rating eligibility', () => {
  it('allows a participant to rate a finished order inside the window', () => {
    expect(ratingBlock(input())).toBeNull();
    expect(canRateOrder(input())).toBe(true);
  });

  it.each(['DISPUTED', 'SETTLED', 'ENDED_EARLY'])('accepts the feedback status %s', (status) => {
    expect(ratingBlock(input({ status }))).toBeNull();
  });

  it.each(['PROPOSED', 'SCHEDULED', 'LIVE', 'CLOSED'])(
    'refuses the non-feedback status %s',
    (status) => {
      expect(ratingBlock(input({ status }))).toBe('orderNotFinished');
    },
  );

  it('refuses an outsider before anything else', () => {
    expect(ratingBlock(input({ participant: false, status: 'PROPOSED', reportedByViewer: true }))).toBe(
      'notParticipant',
    );
  });

  it('has no completion instant to measure the window from', () => {
    expect(ratingBlock(input({ endedAt: null, scheduledEndAt: null }))).toBe('noCompletionTime');
  });

  it('falls back to the scheduled end the same way the POST always did', () => {
    // The order view used to read `endedAt` only, so an order whose posted guard
    // still had a scheduled end would show the button and then refuse it.
    expect(ratingBlock(input({ endedAt: null, scheduledEndAt: new Date(NOW.getTime() - HOUR) }))).toBeNull();
  });

  it('closes the window right after the deadline, not on it', () => {
    const lastUsable = new Date(NOW.getTime() - 24 * HOUR);
    expect(ratingBlock(input({ endedAt: lastUsable }))).toBeNull();
    expect(ratingBlock(input({ endedAt: new Date(lastUsable.getTime() - 1) }))).toBe('windowClosed');
  });

  it('refuses someone who reported the order even though they have not rated it', () => {
    // The clause the `canRate` flag was missing; every press of the button was a 409.
    expect(ratingBlock(input({ reportedByViewer: true }))).toBe('reportedOrder');
  });

  it('names the report before the missing rating when both are true', () => {
    expect(ratingBlock(input({ reportedByViewer: true, ratedByViewer: true }))).toBe('reportedOrder');
  });

  it('refuses a second rating', () => {
    expect(ratingBlock(input({ ratedByViewer: true }))).toBe('alreadyRated');
  });

  describe('ratingBlockedError', () => {
    it('keeps the code the clients already map', () => {
      expect(ratingBlockedError('alreadyRated', 24).message).toBe('You already rated this order');
      expect(ratingBlockedError('windowClosed', 12).message).toContain('within 12 hours');
      expect(ratingBlockedError('notParticipant', 12).status).toBe(403);
    });

    it('gives the report block its own code instead of a bare conflict', () => {
      const error = ratingBlockedError('reportedOrder', 24);
      expect(error.code).toBe('rating_blocked_by_report');
      expect(error.status).toBe(409);
    });
  });
});
