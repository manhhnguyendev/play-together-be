import {
  assertPositiveVnd,
  feeOf,
  quoteEarlyEnd,
  rankingPointsOf,
  ratingAverage,
  splitFee,
} from './money';

describe('money helpers', () => {
  describe('assertPositiveVnd', () => {
    it('accepts positive integer amounts', () => {
      expect(() => assertPositiveVnd(1)).not.toThrow();
      expect(() => assertPositiveVnd(10_000, 'price')).not.toThrow();
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects %p', (amount) => {
      expect(() => assertPositiveVnd(amount)).toThrow(/positive integer/);
    });
  });

  describe('feeOf / splitFee', () => {
    it('takes a 10% commission in integer VND', () => {
      expect(feeOf(100_000, 1000)).toBe(10_000);
      expect(splitFee(100_000, 1000)).toEqual({ fee: 10_000, payout: 90_000 });
    });

    it('rounds half up for odd amounts', () => {
      expect(feeOf(99_999, 1000)).toBe(10_000);
      expect(feeOf(1, 5000)).toBe(1);
    });

    it('rejects invalid basis points', () => {
      expect(() => feeOf(100, -1)).toThrow(/feeBps/);
      expect(() => feeOf(100, 10_001)).toThrow(/feeBps/);
      expect(() => feeOf(100, 10.5)).toThrow(/feeBps/);
    });
  });

  describe('quoteEarlyEnd', () => {
    const total = 100_000;
    const totalMs = 3_600_000;

    it('refuses to settle within the first 10% of the session', () => {
      expect(quoteEarlyEnd(total, 0, totalMs)).toEqual({ eligible: false, tenths: 0, earned: 0, refund: total });
      expect(quoteEarlyEnd(total, totalMs * 0.1, totalMs)).toEqual({
        eligible: false,
        tenths: 0,
        earned: 0,
        refund: total,
      });
    });

    it('pays in completed 10% buckets and refunds the rest', () => {
      expect(quoteEarlyEnd(total, totalMs * 0.25, totalMs)).toEqual({
        eligible: true,
        tenths: 2,
        earned: 20_000,
        refund: 80_000,
      });
    });

    it('treats 90% elapsed as a full session', () => {
      expect(quoteEarlyEnd(total, totalMs * 0.9, totalMs)).toEqual({
        eligible: true,
        tenths: 10,
        earned: total,
        refund: 0,
      });
      expect(quoteEarlyEnd(total, totalMs * 2, totalMs)).toEqual({
        eligible: true,
        tenths: 10,
        earned: total,
        refund: 0,
      });
    });

    it('validates its inputs', () => {
      expect(() => quoteEarlyEnd(-1, 0, totalMs)).toThrow(/non-negative/);
      expect(() => quoteEarlyEnd(total, 0, 0)).toThrow(/positive/);
    });
  });

  describe('ratingAverage', () => {
    it('returns zero when nobody has rated', () => {
      expect(ratingAverage(0, 0)).toBe(0);
    });

    it('rounds to two decimals', () => {
      expect(ratingAverage(9, 2)).toBe(4.5);
      expect(ratingAverage(14, 3)).toBe(4.67);
    });
  });

  describe('rankingPointsOf', () => {
    it('combines rating, completed orders, punctuality and behavior', () => {
      expect(
        rankingPointsOf({
          ratingSum: 45,
          ratingCount: 10,
          completedOrders: 10,
          onTimeCount: 8,
          behaviorPoints: 100,
        }),
      ).toBe(1030);
    });

    it('penalises low behavior points', () => {
      expect(
        rankingPointsOf({
          ratingSum: 45,
          ratingCount: 10,
          completedOrders: 10,
          onTimeCount: 8,
          behaviorPoints: 90,
        }),
      ).toBe(980);
    });

    it('never returns a negative score', () => {
      expect(
        rankingPointsOf({
          ratingSum: 0,
          ratingCount: 0,
          completedOrders: 0,
          onTimeCount: 0,
          behaviorPoints: 0,
        }),
      ).toBe(0);
    });
  });
});
