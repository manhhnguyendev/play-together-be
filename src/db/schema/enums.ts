import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['USER', 'ADMIN', 'CHARITY']);
export const userStatusEnum = pgEnum('user_status', ['ONLINE', 'OFFLINE', 'BUSY', 'MAINTAIN']);
export const genderEnum = pgEnum('gender', ['MALE', 'FEMALE', 'OTHER']);

/**
 * Staff tiers of the admin console, stored as `users.admin_role`.
 *
 * Deliberately not a Postgres enum: `users.role` already answers "who is this
 * account in the marketplace" (USER/ADMIN/CHARITY) and redefining a live column
 * would rewrite existing user data. This is an additive, app-checked label, and
 * a text column keeps `ALTER TYPE ADD VALUE` — which cannot run inside a
 * transaction — out of every future role addition.
 */
export const ADMIN_ROLES = ['SUPER_ADMIN', 'MODERATOR', 'FINANCE'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** The tier that satisfies every admin permission, so routes need not list it. */
export const SUPER_ADMIN_ROLE: AdminRole = 'SUPER_ADMIN';

/**
 * Lifecycle stage of an order. Nine values used to carry the stage and the
 * reason in the same field — `REJECTED`, `CANCELLED`, `EXPIRED` and
 * `INTERRUPTED` were one closed order wearing four names, and
 * `ENDED_EARLY_BY_HIRER` / `_BY_PLAYER` were one settlement with the actor
 * baked in. Stage now lives here; the reason lives in `close_reason` and
 * `ended_early_by`, both of which were already recorded in
 * `order_status_history`.
 *
 * `SCHEDULED` arrives with real booking slots and `DISPUTED` with the payout
 * objection window. They are declared now because Postgres refuses
 * `ALTER TYPE ADD VALUE` inside a transaction, so adding them later would need
 * a migration that cannot run.
 */
export const orderStatusEnum = pgEnum('order_status', [
  'PROPOSED',
  'SCHEDULED',
  'LIVE',
  'DISPUTED',
  'ENDED_EARLY',
  'SETTLED',
  'CLOSED',
]);

export const orderCloseReasonEnum = pgEnum('order_close_reason', [
  'REJECTED_BY_PLAYER',
  'CANCELLED_BY_HIRER',
  'EXPIRED',
  'INTERRUPTED_BY_ADMIN',
]);

export const orderPartyEnum = pgEnum('order_party', ['HIRER', 'PLAYER']);

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
