CREATE TABLE "bot_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" text DEFAULT '1531418977677475992' NOT NULL,
	"reminder_enabled" boolean DEFAULT true NOT NULL,
	"reminder_interval_minutes" integer DEFAULT 1 NOT NULL,
	"reminder_message" text DEFAULT 'Here is the lotto channel.
You can play many games to win money.
Here are all the commands:
/blackjack
/higher-lower
/roulette

Many other commands are available in the #cmds🤖

/balance
/crime
/deposit
/collect-income
/item buy
/item info
/item inventory
/withdraw
/work
And more!' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"level" text DEFAULT 'INFO' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"connected" boolean DEFAULT false NOT NULL,
	"bot_name" text,
	"bot_id" text,
	"started_at" timestamp with time zone,
	"last_reminder_at" timestamp with time zone,
	"reminders_sent_today" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "command_configs" (
	"command_name" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"admin_only" boolean DEFAULT false NOT NULL,
	"label" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command_manifest" (
	"name" text PRIMARY KEY NOT NULL,
	"default_label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_commands" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"match_mode" text DEFAULT 'exact' NOT NULL,
	"case_sensitive" boolean DEFAULT false NOT NULL,
	"response_type" text DEFAULT 'message' NOT NULL,
	"response" text DEFAULT '' NOT NULL,
	"embed_title" text DEFAULT '' NOT NULL,
	"embed_color" text DEFAULT '5865F2' NOT NULL,
	"embed_footer" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"delete_user_message" boolean DEFAULT false NOT NULL,
	"reply_to_user" boolean DEFAULT false NOT NULL,
	"allowed_channels" text DEFAULT '' NOT NULL,
	"allowed_roles" text DEFAULT '' NOT NULL,
	"cooldown_seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economy_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"starting_wallet" integer DEFAULT 200 NOT NULL,
	"balance_enabled" boolean DEFAULT true NOT NULL,
	"money_enabled" boolean DEFAULT true NOT NULL,
	"daily_enabled" boolean DEFAULT true NOT NULL,
	"daily_amount" integer DEFAULT 500 NOT NULL,
	"daily_cooldown_hours" integer DEFAULT 24 NOT NULL,
	"work_enabled" boolean DEFAULT true NOT NULL,
	"work_min_amount" integer DEFAULT 50 NOT NULL,
	"work_max_amount" integer DEFAULT 200 NOT NULL,
	"work_cooldown_hours" integer DEFAULT 1 NOT NULL,
	"crime_enabled" boolean DEFAULT true NOT NULL,
	"crime_win_min" integer DEFAULT 100 NOT NULL,
	"crime_win_max" integer DEFAULT 500 NOT NULL,
	"crime_lose_min" integer DEFAULT 50 NOT NULL,
	"crime_lose_max" integer DEFAULT 200 NOT NULL,
	"crime_win_chance" integer DEFAULT 60 NOT NULL,
	"crime_cooldown_hours" integer DEFAULT 2 NOT NULL,
	"deposit_enabled" boolean DEFAULT true NOT NULL,
	"withdraw_enabled" boolean DEFAULT true NOT NULL,
	"give_enabled" boolean DEFAULT true NOT NULL,
	"leaderboard_enabled" boolean DEFAULT true NOT NULL,
	"blackjack_enabled" boolean DEFAULT true NOT NULL,
	"blackjack_min_bet" integer DEFAULT 10 NOT NULL,
	"blackjack_max_bet" integer DEFAULT 1000 NOT NULL,
	"roulette_enabled" boolean DEFAULT true NOT NULL,
	"roulette_min_bet" integer DEFAULT 10 NOT NULL,
	"roulette_max_bet" integer DEFAULT 1000 NOT NULL,
	"hl_enabled" boolean DEFAULT true NOT NULL,
	"hl_min_bet" integer DEFAULT 10 NOT NULL,
	"hl_max_bet" integer DEFAULT 500 NOT NULL,
	"hl_streak_reward" integer DEFAULT 25 NOT NULL,
	"guess_enabled" boolean DEFAULT true NOT NULL,
	"guess_min_bet" integer DEFAULT 10 NOT NULL,
	"guess_max_bet" integer DEFAULT 1000 NOT NULL,
	"guess_max_attempts" integer DEFAULT 7 NOT NULL,
	"currency_name" text DEFAULT 'coins' NOT NULL,
	"message_reward_enabled" boolean DEFAULT false NOT NULL,
	"message_reward_min" integer DEFAULT 1 NOT NULL,
	"message_reward_max" integer DEFAULT 10 NOT NULL,
	"message_reward_cooldown_seconds" integer DEFAULT 60 NOT NULL,
	"language" text DEFAULT 'fr' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "giveaways" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"guild_id" text DEFAULT '' NOT NULL,
	"prize" text NOT NULL,
	"winners_count" integer DEFAULT 1 NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"winners" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"required_role_id" text,
	"required_min_balance" integer,
	"required_role_ids" text[] DEFAULT '{}' NOT NULL,
	"forbidden_role_ids" text[] DEFAULT '{}' NOT NULL,
	"host_id" text,
	"mentioned_user_ids" text[] DEFAULT '{}' NOT NULL,
	"mentioned_role_ids" text[] DEFAULT '{}' NOT NULL,
	"rewards" json DEFAULT '[]'::json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "random_activity_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"channel_id" text DEFAULT '' NOT NULL,
	"topic" text DEFAULT '' NOT NULL,
	"min_interval_minutes" integer DEFAULT 30 NOT NULL,
	"max_interval_minutes" integer DEFAULT 120 NOT NULL,
	"include_command_suggestions" boolean DEFAULT true NOT NULL,
	"next_send_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "random_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text DEFAULT 'Reminder' NOT NULL,
	"channel_id" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"interval_minutes" integer DEFAULT 60 NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_rewards_sync_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total" integer,
	"processed" integer,
	"errors" integer,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "role_rewards" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger_role_id" text NOT NULL,
	"reward_role_id" text NOT NULL,
	"remove_role_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" bigint DEFAULT 0 NOT NULL,
	"role_id" text,
	"emoji" text DEFAULT '🛍️' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporary_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"role_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"panel_channel_id" text DEFAULT '' NOT NULL,
	"category_id" text DEFAULT '' NOT NULL,
	"staff_role_id" text DEFAULT '' NOT NULL,
	"embed_title" text DEFAULT '🎫 Support' NOT NULL,
	"embed_description" text DEFAULT 'Cliquez sur le bouton ci-dessous pour ouvrir un ticket de support.
Un membre du staff vous répondra dès que possible.' NOT NULL,
	"embed_color" text DEFAULT '5865F2' NOT NULL,
	"log_channel_id" text DEFAULT '' NOT NULL,
	"welcome_message" text DEFAULT 'Bonjour {user} ! Un membre du staff va vous répondre bientôt.' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text DEFAULT '' NOT NULL,
	"channel_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"closed_by_name" text
);
--> statement-breakpoint
CREATE TABLE "user_economy" (
	"user_id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"wallet" bigint DEFAULT 0 NOT NULL,
	"bank" bigint DEFAULT 0 NOT NULL,
	"last_daily" timestamp with time zone,
	"last_work" timestamp with time zone,
	"last_crime" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_inventory" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item_id" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"source" text DEFAULT 'buy' NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "welcome_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"join_enabled" boolean DEFAULT false NOT NULL,
	"join_channel_id" text DEFAULT '' NOT NULL,
	"join_embed_title" text DEFAULT 'Bienvenue sur {server} ! 🎉' NOT NULL,
	"join_embed_description" text DEFAULT 'Bienvenue {mention}, tu es le **{count}ème** membre !' NOT NULL,
	"join_embed_color" text DEFAULT '57F287' NOT NULL,
	"join_embed_footer" text DEFAULT '' NOT NULL,
	"join_show_avatar" boolean DEFAULT true NOT NULL,
	"leave_enabled" boolean DEFAULT false NOT NULL,
	"leave_channel_id" text DEFAULT '' NOT NULL,
	"leave_embed_title" text DEFAULT '{user} a quitté le serveur. 👋' NOT NULL,
	"leave_embed_description" text DEFAULT 'Nous sommes maintenant **{count}** membres.' NOT NULL,
	"leave_embed_color" text DEFAULT 'ED4245' NOT NULL,
	"leave_embed_footer" text DEFAULT '' NOT NULL,
	"leave_show_avatar" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_inventory" ADD CONSTRAINT "user_inventory_item_id_shop_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shop_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tmp_role_expires_idx" ON "temporary_roles" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "inv_user_idx" ON "user_inventory" USING btree ("user_id");