import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['USER', 'ADMIN', 'CHARITY']);
export const userStatusEnum = pgEnum('user_status', ['ONLINE', 'OFFLINE', 'BUSY', 'MAINTAIN']);
export const genderEnum = pgEnum('gender', ['MALE', 'FEMALE', 'OTHER']);

export const orderStatusEnum = pgEnum('order_status', [
  'PROCESSING',
  'ACCEPTED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
  'ENDED_EARLY_BY_HIRER',
  'ENDED_EARLY_BY_PLAYER',
  'INTERRUPTED',
]);

export const escrowStatusEnum = pgEnum('escrow_status', ['HELD', 'SETTLED', 'REFUNDED', 'PARTIALLY_SETTLED']);

export const ledgerDirectionEnum = pgEnum('ledger_direction', ['DEBIT', 'CREDIT']);
export const ledgerAccountEnum = pgEnum('ledger_account', ['USER', 'CHARITY', 'PLATFORM', 'ESCROW', 'EXTERNAL']);
export const ledgerTypeEnum = pgEnum('ledger_type', [
  'DEPOSIT',
  'WITHDRAWAL',
  'ESCROW_HOLD',
  'ESCROW_RELEASE',
  'ESCROW_REFUND',
  'ORDER_EARNING',
  'PLATFORM_FEE',
  'DONATION',
  'REPORT_REFUND',
  'MAINTENANCE_REFUND',
  'CHARITY_WITHDRAWAL',
  'ADJUSTMENT',
]);

export const depositStatusEnum = pgEnum('deposit_status', ['PENDING', 'SUCCEEDED', 'FAILED']);
export const payoutStatusEnum = pgEnum('payout_status', ['PENDING', 'PAID', 'REJECTED', 'CANCELLED']);

export const moderationStatusEnum = pgEnum('moderation_status', ['PENDING', 'APPROVED', 'REJECTED']);
export const violationStatusEnum = pgEnum('rating_violation_status', ['NONE', 'FLAGGED', 'UPHELD', 'DISMISSED']);

export const theBehaviorPointTypeEnum = pgEnum('behavior_point_type', ['POINTS', 'SATISFACTION']);
export const behaviorOperationEnum = pgEnum('behavior_operation', ['ADD', 'SUB']);
export const behaviorEventEnum = pgEnum('behavior_event', [
  'RATING_RECEIVED',
  'RATING_REVOKED',
  'ORDER_REJECTED',
  'ORDER_EXPIRED',
  'ORDER_EARLY_END',
  'REPORT_APPROVED',
  'MANUAL_ADJUSTMENT',
]);

export const notificationStatusEnum = pgEnum('notification_status', ['UNREAD', 'READ']);

export const feedbackTypeEnum = pgEnum('feedback_type', ['BUG', 'FEATURE', 'COMPLAINT', 'OTHER']);
