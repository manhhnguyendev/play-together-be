-- Order lifecycle restructure (S3a): nine statuses became seven, and the four
-- ways an order could end without running became CLOSED plus a reason column.
--
-- Drizzle generated this migration as a plain type swap, which cannot run: it
-- cast the existing values into the new enum before mapping them, and added
-- `CLOSED requires close_reason` on top of rows that have no reason yet. The
-- order below is deliberate — widen to text, replace the type, map the data,
-- and only then constrain it.

-- 1. The two new reason types.
CREATE TYPE "public"."order_close_reason" AS ENUM('REJECTED_BY_PLAYER', 'CANCELLED_BY_HIRER', 'EXPIRED', 'INTERRUPTED_BY_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."order_party" AS ENUM('HIRER', 'PLAYER');--> statement-breakpoint

-- 2. The old session indexes filter on `status in ('PROCESSING', 'ACCEPTED')`,
--    so they depend on the enum being dropped and have to go first.
DROP INDEX "orders_one_active_per_hirer";--> statement-breakpoint
DROP INDEX "orders_one_active_per_player";--> statement-breakpoint

-- 3. Take the status columns off the old type so both vocabularies can exist
--    for the length of this migration. The default goes first: Postgres refuses
--    a type change it cannot apply to a default expression.
ALTER TABLE "order_status_history" ALTER COLUMN "from_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "order_status_history" ALTER COLUMN "to_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint

-- 4. Nothing references the old type now.
DROP TYPE "public"."order_status";--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PROPOSED', 'SCHEDULED', 'LIVE', 'DISPUTED', 'ENDED_EARLY', 'SETTLED', 'CLOSED');--> statement-breakpoint

-- 5. Where the reason an order ended used to be the status, it is now data.
ALTER TABLE "orders" ADD COLUMN "close_reason" "order_close_reason";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ended_early_by" "order_party";--> statement-breakpoint

-- 6. Map every stored order onto the new vocabulary and carry the lost detail
--    into the columns that now hold it. `status` is text at this point, so the
--    CASE expressions infer as text too — Postgres will not assign text to an
--    enum column, hence the explicit casts.
UPDATE "orders" SET
  "close_reason" = (CASE "status"
    WHEN 'REJECTED' THEN 'REJECTED_BY_PLAYER'
    WHEN 'CANCELLED' THEN 'CANCELLED_BY_HIRER'
    WHEN 'EXPIRED' THEN 'EXPIRED'
    WHEN 'INTERRUPTED' THEN 'INTERRUPTED_BY_ADMIN'
  END)::"public"."order_close_reason",
  "ended_early_by" = (CASE "status"
    WHEN 'ENDED_EARLY_BY_HIRER' THEN 'HIRER'
    WHEN 'ENDED_EARLY_BY_PLAYER' THEN 'PLAYER'
  END)::"public"."order_party",
  "status" = CASE "status"
    WHEN 'PROCESSING' THEN 'PROPOSED'
    WHEN 'ACCEPTED' THEN 'LIVE'
    WHEN 'COMPLETED' THEN 'SETTLED'
    WHEN 'ENDED_EARLY_BY_HIRER' THEN 'ENDED_EARLY'
    WHEN 'ENDED_EARLY_BY_PLAYER' THEN 'ENDED_EARLY'
    WHEN 'REJECTED' THEN 'CLOSED'
    WHEN 'CANCELLED' THEN 'CLOSED'
    WHEN 'EXPIRED' THEN 'CLOSED'
    WHEN 'INTERRUPTED' THEN 'CLOSED'
    ELSE "status"
  END;--> statement-breakpoint

-- 7. The audit trail is rewritten to the same vocabulary, so a history row read
--    after this migration means the same thing as the status it points at.
UPDATE "order_status_history" SET
  "from_status" = CASE "from_status"
    WHEN 'PROCESSING' THEN 'PROPOSED'
    WHEN 'ACCEPTED' THEN 'LIVE'
    WHEN 'COMPLETED' THEN 'SETTLED'
    WHEN 'ENDED_EARLY_BY_HIRER' THEN 'ENDED_EARLY'
    WHEN 'ENDED_EARLY_BY_PLAYER' THEN 'ENDED_EARLY'
    WHEN 'REJECTED' THEN 'CLOSED'
    WHEN 'CANCELLED' THEN 'CLOSED'
    WHEN 'EXPIRED' THEN 'CLOSED'
    WHEN 'INTERRUPTED' THEN 'CLOSED'
    ELSE "from_status"
  END,
  "to_status" = CASE "to_status"
    WHEN 'PROCESSING' THEN 'PROPOSED'
    WHEN 'ACCEPTED' THEN 'LIVE'
    WHEN 'COMPLETED' THEN 'SETTLED'
    WHEN 'ENDED_EARLY_BY_HIRER' THEN 'ENDED_EARLY'
    WHEN 'ENDED_EARLY_BY_PLAYER' THEN 'ENDED_EARLY'
    WHEN 'REJECTED' THEN 'CLOSED'
    WHEN 'CANCELLED' THEN 'CLOSED'
    WHEN 'EXPIRED' THEN 'CLOSED'
    WHEN 'INTERRUPTED' THEN 'CLOSED'
    ELSE "to_status"
  END;--> statement-breakpoint

-- 8. Every value is now in the new vocabulary, so the cast is safe.
ALTER TABLE "orders" ALTER COLUMN "status" SET DATA TYPE "public"."order_status" USING "status"::"public"."order_status";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PROPOSED'::"public"."order_status";--> statement-breakpoint
ALTER TABLE "order_status_history" ALTER COLUMN "from_status" SET DATA TYPE "public"."order_status" USING "from_status"::"public"."order_status";--> statement-breakpoint
ALTER TABLE "order_status_history" ALTER COLUMN "to_status" SET DATA TYPE "public"."order_status" USING "to_status"::"public"."order_status";--> statement-breakpoint

-- 9. A proposal reserves nobody; only an accepted session occupies a party.
CREATE UNIQUE INDEX "orders_one_session_per_hirer" ON "orders" USING btree ("hirer_id") WHERE "orders"."status" in ('SCHEDULED', 'LIVE', 'DISPUTED');--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_session_per_player" ON "orders" USING btree ("player_id") WHERE "orders"."status" in ('SCHEDULED', 'LIVE', 'DISPUTED');--> statement-breakpoint

-- 10. Finally the invariants that make the split between stage and reason real.
ALTER TABLE "orders" ADD CONSTRAINT "orders_close_reason_check" CHECK ("orders"."status" <> 'CLOSED' or "orders"."close_reason" is not null);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_ended_early_by_check" CHECK ("orders"."status" <> 'ENDED_EARLY' or "orders"."ended_early_by" is not null);
