CREATE TABLE "admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid,
	"admin_role" varchar(16),
	"action" varchar(64) NOT NULL,
	"entity" varchar(32) NOT NULL,
	"entity_id" uuid,
	"reason" varchar(500),
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "admin_role" varchar(16);--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_logs_created_idx" ON "admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_admin_idx" ON "admin_audit_logs" USING btree ("admin_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_entity_idx" ON "admin_audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "users_admin_role_idx" ON "users" USING btree ("admin_role");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_admin_role_check" CHECK ("users"."admin_role" is null or "users"."admin_role" in ('SUPER_ADMIN', 'MODERATOR', 'FINANCE'));--> statement-breakpoint
-- Backfill before the console starts reading the column, otherwise every account
-- that is staff today loses access on deploy day. `role` still decides who the
-- account is in the marketplace; the existing admins all become super users.
UPDATE "users" SET "admin_role" = 'SUPER_ADMIN' WHERE "role" = 'ADMIN' AND "admin_role" is null;