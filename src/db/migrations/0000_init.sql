CREATE TYPE "public"."behavior_event" AS ENUM('RATING_RECEIVED', 'RATING_REVOKED', 'ORDER_REJECTED', 'ORDER_EXPIRED', 'ORDER_EARLY_END', 'REPORT_APPROVED', 'MANUAL_ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."behavior_operation" AS ENUM('ADD', 'SUB');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."escrow_status" AS ENUM('HELD', 'SETTLED', 'REFUNDED', 'PARTIALLY_SETTLED');--> statement-breakpoint
CREATE TYPE "public"."feedback_type" AS ENUM('BUG', 'FEATURE', 'COMPLAINT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('MALE', 'FEMALE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."ledger_account" AS ENUM('USER', 'CHARITY', 'PLATFORM', 'ESCROW', 'EXTERNAL');--> statement-breakpoint
CREATE TYPE "public"."ledger_direction" AS ENUM('DEBIT', 'CREDIT');--> statement-breakpoint
CREATE TYPE "public"."ledger_type" AS ENUM('DEPOSIT', 'WITHDRAWAL', 'ESCROW_HOLD', 'ESCROW_RELEASE', 'ESCROW_REFUND', 'ORDER_EARNING', 'PLATFORM_FEE', 'DONATION', 'REPORT_REFUND', 'MAINTENANCE_REFUND', 'CHARITY_WITHDRAWAL', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."moderation_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('UNREAD', 'READ');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PROCESSING', 'ACCEPTED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'ENDED_EARLY_BY_HIRER', 'ENDED_EARLY_BY_PLAYER', 'INTERRUPTED');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('PENDING', 'PAID', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."behavior_point_type" AS ENUM('POINTS', 'SATISFACTION');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('USER', 'ADMIN', 'CHARITY');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ONLINE', 'OFFLINE', 'BUSY', 'MAINTAIN');--> statement-breakpoint
CREATE TYPE "public"."rating_violation_status" AS ENUM('NONE', 'FLAGGED', 'UPHELD', 'DISMISSED');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255),
	"google_id" varchar(255),
	"role" "user_role" DEFAULT 'USER' NOT NULL,
	"name" varchar(100) NOT NULL,
	"date_of_birth" date,
	"city" varchar(100),
	"gender" "gender" DEFAULT 'OTHER' NOT NULL,
	"avatar_url" text,
	"bio" text,
	"status" "user_status" DEFAULT 'ONLINE' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_player" boolean DEFAULT false NOT NULL,
	"price_per_hour" bigint DEFAULT 10000 NOT NULL,
	"max_hours_per_hire" integer DEFAULT 1 NOT NULL,
	"rating_sum" integer DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"completed_orders_count" integer DEFAULT 0 NOT NULL,
	"total_hours" integer DEFAULT 0 NOT NULL,
	"on_time_count" integer DEFAULT 0 NOT NULL,
	"ranking_points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_price_per_hour_check" CHECK ("users"."price_per_hour" >= 0),
	CONSTRAINT "users_max_hours_check" CHECK ("users"."max_hours_per_hire" between 1 and 12),
	CONSTRAINT "users_rating_count_check" CHECK ("users"."rating_count" >= 0),
	CONSTRAINT "users_rating_sum_check" CHECK ("users"."rating_sum" between 0 and "users"."rating_count" * 5),
	CONSTRAINT "users_ranking_points_check" CHECK ("users"."ranking_points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_day_check" CHECK ("availability_windows"."day_of_week" between 1 and 7),
	CONSTRAINT "availability_start_check" CHECK ("availability_windows"."start_minute" between 0 and 1439),
	CONSTRAINT "availability_end_check" CHECK ("availability_windows"."end_minute" between 1 and 1440),
	CONSTRAINT "availability_range_check" CHECK ("availability_windows"."start_minute" < "availability_windows"."end_minute")
);
--> statement-breakpoint
CREATE TABLE "game_ranks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"no" smallint NOT NULL,
	"name" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_ranks_no_check" CHECK ("game_ranks"."no" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "game_type_links" (
	"game_id" uuid NOT NULL,
	"game_type_id" uuid NOT NULL,
	CONSTRAINT "game_type_links_game_id_game_type_id_pk" PRIMARY KEY("game_id","game_type_id")
);
--> statement-breakpoint
CREATE TABLE "game_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"short_name" varchar(50),
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"display_name" varchar(100),
	"other_names" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_hobbies" (
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_hobbies_user_id_game_id_pk" PRIMARY KEY("user_id","game_id")
);
--> statement-breakpoint
CREATE TABLE "user_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"rank_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_games" (
	"order_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	CONSTRAINT "order_games_order_id_game_id_pk" PRIMARY KEY("order_id","game_id")
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"actor_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hirer_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'PROCESSING' NOT NULL,
	"hours" smallint NOT NULL,
	"hourly_rate" bigint NOT NULL,
	"total_price" bigint NOT NULL,
	"fee_bps" integer NOT NULL,
	"player_payout" bigint,
	"message" varchar(500) NOT NULL,
	"reason" varchar(500),
	"respond_by" timestamp with time zone NOT NULL,
	"starts_at" timestamp with time zone,
	"scheduled_end_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_hours_check" CHECK ("orders"."hours" between 1 and 12),
	CONSTRAINT "orders_total_price_check" CHECK ("orders"."total_price" >= 0),
	CONSTRAINT "orders_fee_check" CHECK ("orders"."fee_bps" between 0 and 5000),
	CONSTRAINT "orders_payout_check" CHECK ("orders"."player_payout" is null or "orders"."player_payout" between 0 and "orders"."total_price"),
	CONSTRAINT "orders_distinct_parties_check" CHECK ("orders"."hirer_id" <> "orders"."player_id")
);
--> statement-breakpoint
CREATE TABLE "charities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_name" varchar(150) NOT NULL,
	"avatar_url" text,
	"information" text,
	"address" varchar(200),
	"email" varchar(255),
	"phone" varchar(20),
	"balance" bigint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charities_balance_check" CHECK ("charities"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "charity_withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charity_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"status" "payout_status" DEFAULT 'PENDING' NOT NULL,
	"note" varchar(255),
	"processed_by" uuid,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charity_withdrawals_amount_check" CHECK ("charity_withdrawals"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donor_id" uuid NOT NULL,
	"charity_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"message" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donations_amount_check" CHECK ("donations"."amount" >= 1000)
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"provider" varchar(30) DEFAULT 'MOMO' NOT NULL,
	"provider_txn_id" varchar(100),
	"status" "deposit_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "deposits_amount_check" CHECK ("deposits"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "escrow_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"hirer_wallet_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"status" "escrow_status" DEFAULT 'HELD' NOT NULL,
	"settled_amount" bigint DEFAULT 0 NOT NULL,
	"refunded_amount" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "escrow_holds_amount_check" CHECK ("escrow_holds"."amount" > 0),
	CONSTRAINT "escrow_holds_settled_check" CHECK ("escrow_holds"."settled_amount" >= 0),
	CONSTRAINT "escrow_holds_refunded_check" CHECK ("escrow_holds"."refunded_amount" >= 0),
	CONSTRAINT "escrow_holds_total_check" CHECK ("escrow_holds"."settled_amount" + "escrow_holds"."refunded_amount" <= "escrow_holds"."amount")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_type" "ledger_account" NOT NULL,
	"account_id" uuid,
	"wallet_id" uuid,
	"charity_id" uuid,
	"order_id" uuid,
	"direction" "ledger_direction" NOT NULL,
	"type" "ledger_type" NOT NULL,
	"amount" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_amount_check" CHECK ("ledger_entries"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "pending_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_credits_amount_check" CHECK ("pending_credits"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"available_balance" bigint DEFAULT 0 NOT NULL,
	"pending_balance" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_available_check" CHECK ("wallets"."available_balance" >= 0),
	CONSTRAINT "wallets_pending_check" CHECK ("wallets"."pending_balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"provider" varchar(30) DEFAULT 'MOMO' NOT NULL,
	"provider_txn_id" varchar(100),
	"status" "payout_status" DEFAULT 'PENDING' NOT NULL,
	"note" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "withdrawals_amount_check" CHECK ("withdrawals"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "behavior_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event" "behavior_event" NOT NULL,
	"operation" "behavior_operation" NOT NULL,
	"point_type" "behavior_point_type" NOT NULL,
	"amount" integer NOT NULL,
	"reference_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "behavior_history_amount_check" CHECK ("behavior_history"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "behavior_points" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"points" integer DEFAULT 100 NOT NULL,
	"satisfaction" integer DEFAULT 100 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "behavior_points_points_check" CHECK ("behavior_points"."points" between 0 and 100),
	CONSTRAINT "behavior_points_satisfaction_check" CHECK ("behavior_points"."satisfaction" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"rater_id" uuid NOT NULL,
	"ratee_id" uuid NOT NULL,
	"rate" smallint NOT NULL,
	"comment" varchar(500),
	"is_active" boolean DEFAULT true NOT NULL,
	"violation_status" "rating_violation_status" DEFAULT 'NONE' NOT NULL,
	"violation_reason" varchar(500),
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_rate_check" CHECK ("ratings"."rate" between 1 and 5),
	CONSTRAINT "ratings_parties_check" CHECK ("ratings"."rater_id" <> "ratings"."ratee_id")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"message" varchar(500) NOT NULL,
	"status" "moderation_status" DEFAULT 'PENDING' NOT NULL,
	"resolution_note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_parties_check" CHECK ("reports"."reporter_id" <> "reports"."target_id")
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"receiver_id" uuid NOT NULL,
	"message" varchar(2000) NOT NULL,
	"is_recalled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chats_parties_check" CHECK ("chats"."sender_id" <> "chats"."receiver_id")
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"message" varchar(2000) NOT NULL,
	"type" "feedback_type" DEFAULT 'OTHER' NOT NULL,
	"status" "moderation_status" DEFAULT 'PENDING' NOT NULL,
	"admin_note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" varchar(1000) NOT NULL,
	"reference_url" text,
	"status" "notification_status" DEFAULT 'UNREAD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "search_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"query" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"blocked_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_parties_check" CHECK ("user_blocks"."user_id" <> "user_blocks"."blocked_user_id")
);
--> statement-breakpoint
CREATE TABLE "system_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"no" integer NOT NULL,
	"title" varchar(150) NOT NULL,
	"value" integer NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_configs_value_check" CHECK ("system_configs"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_windows" ADD CONSTRAINT "availability_windows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_ranks" ADD CONSTRAINT "game_ranks_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_type_links" ADD CONSTRAINT "game_type_links_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_type_links" ADD CONSTRAINT "game_type_links_game_type_id_game_types_id_fk" FOREIGN KEY ("game_type_id") REFERENCES "public"."game_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_hobbies" ADD CONSTRAINT "user_hobbies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_hobbies" ADD CONSTRAINT "user_hobbies_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_images" ADD CONSTRAINT "user_images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_rank_id_game_ranks_id_fk" FOREIGN KEY ("rank_id") REFERENCES "public"."game_ranks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_games" ADD CONSTRAINT "order_games_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_games" ADD CONSTRAINT "order_games_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_hirer_id_users_id_fk" FOREIGN KEY ("hirer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_player_id_users_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charities" ADD CONSTRAINT "charities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charity_withdrawals" ADD CONSTRAINT "charity_withdrawals_charity_id_charities_id_fk" FOREIGN KEY ("charity_id") REFERENCES "public"."charities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charity_withdrawals" ADD CONSTRAINT "charity_withdrawals_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_donor_id_users_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_charity_id_charities_id_fk" FOREIGN KEY ("charity_id") REFERENCES "public"."charities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_holds" ADD CONSTRAINT "escrow_holds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_holds" ADD CONSTRAINT "escrow_holds_hirer_wallet_id_wallets_id_fk" FOREIGN KEY ("hirer_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_charity_id_charities_id_fk" FOREIGN KEY ("charity_id") REFERENCES "public"."charities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_credits" ADD CONSTRAINT "pending_credits_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_credits" ADD CONSTRAINT "pending_credits_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "behavior_history" ADD CONSTRAINT "behavior_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "behavior_points" ADD CONSTRAINT "behavior_points_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rater_id_users_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_ratee_id_users_id_fk" FOREIGN KEY ("ratee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_receiver_id_users_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_user_id_users_id_fk" FOREIGN KEY ("blocked_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_id_key" ON "users" USING btree ("google_id") WHERE "users"."google_id" is not null;--> statement-breakpoint
CREATE INDEX "users_player_search_idx" ON "users" USING btree ("is_player","status","rating_sum");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_hash_key" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_key" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "availability_windows_user_idx" ON "availability_windows" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_ranks_game_no_key" ON "game_ranks" USING btree ("game_id","no");--> statement-breakpoint
CREATE UNIQUE INDEX "game_types_name_key" ON "game_types" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "games_name_key" ON "games" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "user_hobbies_game_idx" ON "user_hobbies" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "user_images_user_idx" ON "user_images" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_skills_user_game_key" ON "user_skills" USING btree ("user_id","game_id");--> statement-breakpoint
CREATE INDEX "user_skills_game_idx" ON "user_skills" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "order_games_game_idx" ON "order_games" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "order_status_history_order_idx" ON "order_status_history" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_active_per_hirer" ON "orders" USING btree ("hirer_id") WHERE "orders"."status" in ('PROCESSING', 'ACCEPTED');--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_active_per_player" ON "orders" USING btree ("player_id") WHERE "orders"."status" in ('PROCESSING', 'ACCEPTED');--> statement-breakpoint
CREATE INDEX "orders_hirer_idx" ON "orders" USING btree ("hirer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_player_idx" ON "orders" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status","respond_by");--> statement-breakpoint
CREATE UNIQUE INDEX "charities_user_key" ON "charities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "charities_active_idx" ON "charities" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "charity_withdrawals_charity_idx" ON "charity_withdrawals" USING btree ("charity_id","created_at");--> statement-breakpoint
CREATE INDEX "donations_charity_idx" ON "donations" USING btree ("charity_id","created_at");--> statement-breakpoint
CREATE INDEX "donations_donor_idx" ON "donations" USING btree ("donor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_provider_txn_key" ON "deposits" USING btree ("provider_txn_id") WHERE "deposits"."provider_txn_id" is not null;--> statement-breakpoint
CREATE INDEX "deposits_user_idx" ON "deposits" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "escrow_holds_order_key" ON "escrow_holds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_transaction_idx" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_wallet_idx" ON "ledger_entries" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_charity_idx" ON "ledger_entries" USING btree ("charity_id","created_at");--> statement-breakpoint
CREATE INDEX "pending_credits_release_idx" ON "pending_credits" USING btree ("released_at","available_at");--> statement-breakpoint
CREATE INDEX "pending_credits_wallet_idx" ON "pending_credits" USING btree ("wallet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_user_key" ON "wallets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "withdrawals_user_idx" ON "withdrawals" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "behavior_history_user_idx" ON "behavior_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_order_rater_key" ON "ratings" USING btree ("order_id","rater_id");--> statement-breakpoint
CREATE INDEX "ratings_ratee_idx" ON "ratings" USING btree ("ratee_id","is_active","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_order_reporter_key" ON "reports" USING btree ("order_id","reporter_id");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "chats_sender_idx" ON "chats" USING btree ("sender_id","created_at");--> statement-breakpoint
CREATE INDEX "chats_receiver_idx" ON "chats" USING btree ("receiver_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_status_idx" ON "feedback" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "feedback_user_idx" ON "feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "search_history_user_query_key" ON "search_history" USING btree ("user_id",lower("query"));--> statement-breakpoint
CREATE INDEX "search_history_user_idx" ON "search_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_blocks_pair_key" ON "user_blocks" USING btree ("user_id","blocked_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "system_configs_key_key" ON "system_configs" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "system_configs_no_key" ON "system_configs" USING btree ("no");--> statement-breakpoint
CREATE INDEX "system_configs_no_idx" ON "system_configs" USING btree ("no");