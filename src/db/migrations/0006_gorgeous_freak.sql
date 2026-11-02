DROP INDEX "orders_one_session_per_hirer";--> statement-breakpoint
DROP INDEX "orders_one_session_per_player";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "disputed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "orders_disputed_idx" ON "orders" USING btree ("disputed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_session_per_hirer" ON "orders" USING btree ("hirer_id") WHERE "orders"."status" in ('SCHEDULED', 'LIVE');--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_session_per_player" ON "orders" USING btree ("player_id") WHERE "orders"."status" in ('SCHEDULED', 'LIVE');--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_disputed_at_check" CHECK ("orders"."status" <> 'DISPUTED' or "orders"."disputed_at" is not null);