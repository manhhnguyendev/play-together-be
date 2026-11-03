import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { addHours } from '../../common/time/time';
import { FEEDBACK_ORDER_STATUSES } from '../../db/schema';

export type RatingBlock =
  | 'notParticipant'
  | 'orderNotFinished'
  | 'noCompletionTime'
  | 'windowClosed'
  | 'reportedOrder'
  | 'alreadyRated';

export interface RatingEligibilityInput {
  status: string;
  endedAt: Date | null;
  scheduledEndAt: Date | null;
  windowHours: number;
  now: Date;
  participant: boolean;
  ratedByViewer: boolean;
  reportedByViewer: boolean;
}

/**
 * The whole rating rule in one place, because two readers need the same answer.
 *
 * `POST /orders/{id}/ratings` enforced it one way while `hydrate()` in the orders
 * service built the `canRate` flag another way — the flag forgot the report clause
 * and used `endedAt` where the POST accepts `scheduledEndAt` too. The app therefore
 * rendered a "Đánh giá" button whose every press answered 409.
 *
 * Checks run in the order the POST has always reported them in, so no existing
 * error code or message moved.
 */
export function ratingBlock(input: RatingEligibilityInput): RatingBlock | null {
  if (!input.participant) return 'notParticipant';
  if (!isFeedbackStatus(input.status)) return 'orderNotFinished';

  const endedAt = input.endedAt ?? input.scheduledEndAt;
  if (!endedAt) return 'noCompletionTime';
  if (input.now.getTime() > addHours(endedAt, input.windowHours).getTime()) return 'windowClosed';
  if (input.reportedByViewer) return 'reportedOrder';
  if (input.ratedByViewer) return 'alreadyRated';

  return null;
}

export const canRateOrder = (input: RatingEligibilityInput): boolean =>
  ratingBlock(input) === null;

export const isFeedbackStatus = (status: string): boolean =>
  (FEEDBACK_ORDER_STATUSES as readonly string[]).includes(status);

/** Turns a refusal into the problem+json the clients already map to Vietnamese. */
export function ratingBlockedError(block: RatingBlock, windowHours: number): AppError {
  switch (block) {
    case 'notParticipant':
      return AppError.forbidden(
        ErrorCode.orderNotParticipant,
        'Only the hirer or the player can rate this order',
      );
    case 'orderNotFinished':
      return AppError.conflict(
        ErrorCode.invalidOrderState,
        'Only finished orders can be rated',
      );
    case 'noCompletionTime':
      return AppError.conflict(
        ErrorCode.invalidOrderState,
        'Order has no completion timestamp',
      );
    case 'windowClosed':
      return AppError.conflict(
        ErrorCode.feedbackWindowClosed,
        `Ratings are only accepted within ${windowHours} hours of the order ending`,
      );
    case 'reportedOrder':
      return AppError.conflict(
        ErrorCode.ratingBlockedByReport,
        'You already reported the other party on this order, so you cannot rate it',
      );
    case 'alreadyRated':
      return AppError.conflict(ErrorCode.alreadyRated, 'You already rated this order');
  }
}
