DROP INDEX "orders_one_session_per_hirer";--> statement-breakpoint
DROP INDEX "orders_one_session_per_player";--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_live_per_hirer" ON "orders" USING btree ("hirer_id") WHERE "orders"."status" in ('LIVE');--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_live_per_player" ON "orders" USING btree ("player_id") WHERE "orders"."status" in ('LIVE');--> statement-breakpoint
CREATE INDEX "orders_player_starts_idx" ON "orders" USING btree ("player_id","starts_at");--> statement-breakpoint
CREATE INDEX "orders_hirer_starts_idx" ON "orders" USING btree ("hirer_id","starts_at");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_slot_check" CHECK ("orders"."status" <> 'SCHEDULED' or ("orders"."starts_at" is not null and "orders"."scheduled_end_at" is not null));