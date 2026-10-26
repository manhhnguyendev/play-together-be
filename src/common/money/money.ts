export const MIN_HOURS_PER_HIRE = 1;
export const MAX_HOURS_PER_HIRE = 12;
export const MIN_PRICE_PER_HOUR = 10_000;
export const MAX_PRICE_PER_HOUR = 10_000_000;
export const MIN_DONATION = 1_000;
export const MIN_DEPOSIT = 1_000;
export const MAX_DEPOSIT = 100_000_000;
export const MIN_WITHDRAWAL = 10_000;

export function assertPositiveVnd(amount: number, field = 'amount'): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`${field} must be a positive integer amount in VND`);
  }
}

export function feeOf(gross: number, feeBps: number): number {
  if (!Number.isSafeInteger(gross) || gross < 0) throw new Error('gross must be a non-negative integer');
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) throw new Error('feeBps must be 0..10000');
  return Math.round((gross * feeBps) / 10_000);
}

export function splitFee(gross: number, feeBps: number): { fee: number; payout: number } {
  const fee = feeOf(gross, feeBps);
  return { fee, payout: gross - fee };
}

export type EarlyEndQuote = {
  eligible: boolean;
  tenths: number;
  earned: number;
  refund: number;
};

/**
 * Early termination follows the original product rule: the first 10% of the
 * booked time is non-refundable, progress is paid in 10% buckets, and 90%
 * elapsed counts as a fully completed session.
 */
export function quoteEarlyEnd(totalPrice: number, elapsedMs: number, totalMs: number): EarlyEndQuote {
  if (!Number.isSafeInteger(totalPrice) || totalPrice < 0) throw new Error('totalPrice must be a non-negative integer');
  if (totalMs <= 0) throw new Error('totalMs must be positive');

  const ratio = Math.min(Math.max(elapsedMs / totalMs, 0), 1);

  if (ratio <= 0.1) {
    return { eligible: false, tenths: 0, earned: 0, refund: totalPrice };
  }
  if (ratio >= 0.9) {
    return { eligible: true, tenths: 10, earned: totalPrice, refund: 0 };
  }

  const tenths = Math.floor(ratio * 10);
  const earned = Math.round((totalPrice * tenths) / 10);

  return { eligible: true, tenths, earned, refund: totalPrice - earned };
}

export function ratingAverage(ratingSum: number, ratingCount: number): number {
  if (ratingCount <= 0) return 0;
  return Math.round((ratingSum / ratingCount) * 100) / 100;
}

export function rankingPointsOf(stats: {
  ratingSum: number;
  ratingCount: number;
  completedOrders: number;
  onTimeCount: number;
  behaviorPoints: number;
}): number {
  const average = stats.ratingCount > 0 ? stats.ratingSum / stats.ratingCount : 0;
  const score =
    average * 200 + stats.completedOrders * 5 + stats.onTimeCount * 10 - (100 - stats.behaviorPoints) * 5;
  return Math.max(0, Math.round(score));
}
