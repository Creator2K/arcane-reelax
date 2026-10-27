CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"accepted_user_agreement_version" varchar(20) DEFAULT '2026-08-13' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "achievement_definitions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"category" varchar(32) NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" varchar(255) NOT NULL,
	"threshold" bigint NOT NULL,
	"reward_relics" integer DEFAULT 0 NOT NULL,
	"title_id" varchar(64),
	"series_id" varchar(64),
	"series_step" integer,
	"series_total_steps" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arcane_sacrifice_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"resource_type" varchar(16) NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arcane_sacrifice_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_date" varchar(10) NOT NULL,
	"round_number" integer NOT NULL,
	"cycle_ordinal" integer NOT NULL,
	"resource_type" varchar(16) NOT NULL,
	"target" bigint NOT NULL,
	"progress" bigint DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"opens_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"effect_ends_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "avatars" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"image_path" varchar(255) DEFAULT '' NOT NULL,
	"source" varchar(16) DEFAULT 'base' NOT NULL,
	"price_gold" bigint,
	"price_relics" bigint,
	"price_fragments" bigint,
	"is_active" boolean DEFAULT true NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baits" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"tier" varchar(16) NOT NULL,
	"name" varchar(32) NOT NULL,
	"unit_price" integer DEFAULT 0 NOT NULL,
	"luck" integer DEFAULT 0 NOT NULL,
	"min_rarity_index" integer DEFAULT 0 NOT NULL,
	"max_rarity_index" integer DEFAULT 1 NOT NULL,
	"fish_rarity_multipliers" jsonb DEFAULT '{}'::jsonb,
	"allows_relic" boolean DEFAULT false NOT NULL,
	"allows_gear" boolean DEFAULT false NOT NULL,
	"allows_chest" boolean DEFAULT false NOT NULL,
	"is_unlimited" boolean DEFAULT false NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "barter_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"give_fish_id" varchar(64) NOT NULL,
	"want_fish_id" varchar(64) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"cancelled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "barter_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"giver_id" uuid NOT NULL,
	"receiver_id" uuid NOT NULL,
	"give_fish_id" varchar(64) NOT NULL,
	"want_fish_id" varchar(64) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biomes" (
	"id" varchar(16) PRIMARY KEY NOT NULL,
	"name" varchar(32) NOT NULL,
	"theme" text NOT NULL,
	"required_level" integer DEFAULT 0 NOT NULL,
	"unlock_cost" bigint DEFAULT 0 NOT NULL,
	"value_multiplier" real DEFAULT 1 NOT NULL,
	"direct_gold_min" integer DEFAULT 50 NOT NULL,
	"direct_gold_max" integer DEFAULT 100 NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boat_definitions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" varchar(255) NOT NULL,
	"capacity" integer NOT NULL,
	"hourly_rent_gold" bigint NOT NULL,
	"daily_rent_gold" bigint NOT NULL,
	"permanent_price_gold" bigint NOT NULL,
	"maintenance_fourteen_day_gold" bigint NOT NULL,
	"crew_experience_bonus_basis_points" integer DEFAULT 0 NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cdk_codes" (
	"code" varchar(32) PRIMARY KEY NOT NULL,
	"kind" varchar(32) NOT NULL,
	"payload" jsonb NOT NULL,
	"max_redemptions" integer DEFAULT 1 NOT NULL,
	"redemptions" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cdk_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"player_id" uuid NOT NULL,
	"redeemed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chests" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(32) NOT NULL,
	"price" bigint NOT NULL,
	"payment_options" jsonb NOT NULL,
	"rarity_chances" jsonb NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_meta" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"content_version" varchar(16) NOT NULL,
	"stat_reset_cost_gold" bigint DEFAULT 10000 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "convenience_entitlements" (
	"player_id" uuid NOT NULL,
	"product_id" varchar(64) NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"ends_at" timestamp,
	CONSTRAINT "convenience_entitlements_player_id_product_id_pk" PRIMARY KEY("player_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "convenience_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"product_id" varchar(64) NOT NULL,
	"duration_seconds" integer NOT NULL,
	"price_gold" bigint NOT NULL,
	"starts_at" timestamp DEFAULT now() NOT NULL,
	"ends_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_check_ins" (
	"player_id" uuid NOT NULL,
	"date" varchar(10) NOT NULL,
	"cycle_index" integer DEFAULT 1 NOT NULL,
	"reward_day" integer DEFAULT 1 NOT NULL,
	"claimed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "daily_check_ins_player_id_date_pk" PRIMARY KEY("player_id","date")
);
--> statement-breakpoint
CREATE TABLE "daily_harvest" (
	"player_id" uuid NOT NULL,
	"date" varchar(10) NOT NULL,
	"casts" integer DEFAULT 0 NOT NULL,
	"fish_by_rarity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"gear" integer DEFAULT 0 NOT NULL,
	"chests" integer DEFAULT 0 NOT NULL,
	"relics" integer DEFAULT 0 NOT NULL,
	"gold_income" bigint DEFAULT 0 NOT NULL,
	"bait_cost" bigint DEFAULT 0 NOT NULL,
	"net_gold" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_harvest_player_id_date_pk" PRIMARY KEY("player_id","date")
);
--> statement-breakpoint
CREATE TABLE "fish" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"biome_id" varchar(16) NOT NULL,
	"rarity" varchar(16) NOT NULL,
	"sell_price" integer DEFAULT 0 NOT NULL,
	"image_path" varchar(255) DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fishing_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"mode" varchar(16) DEFAULT 'online' NOT NULL,
	"biome_id" varchar(16) NOT NULL,
	"total_casts" integer NOT NULL,
	"remaining_casts" integer NOT NULL,
	"cycle_duration_ms" integer DEFAULT 6000 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"next_cast_at" timestamp,
	"last_sync_at" timestamp DEFAULT now() NOT NULL,
	"offline_since" timestamp,
	"snapshot" jsonb NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"batch_gold" bigint DEFAULT 0 NOT NULL,
	"batch_experience" bigint DEFAULT 0 NOT NULL,
	"batch_fish_quantity" bigint DEFAULT 0 NOT NULL,
	"batch_relics" integer DEFAULT 0 NOT NULL,
	"batch_chests" integer DEFAULT 0 NOT NULL,
	"batch_gear_count" integer DEFAULT 0 NOT NULL,
	"guild_tax_gold" bigint DEFAULT 0 NOT NULL,
	"party_bonus_experience" bigint DEFAULT 0 NOT NULL,
	"ended_at" timestamp,
	"end_reason" varchar(32)
);
--> statement-breakpoint
CREATE TABLE "gear_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"template_id" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"slot" varchar(16) NOT NULL,
	"rarity" varchar(16) NOT NULL,
	"quality" integer DEFAULT 0 NOT NULL,
	"quality_stars" integer DEFAULT 0 NOT NULL,
	"base_stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"upgrade_level" integer DEFAULT 0 NOT NULL,
	"is_equipped" boolean DEFAULT false NOT NULL,
	"is_market_listed" boolean DEFAULT false NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"source_biome_id" varchar(16),
	"content_version" varchar(16) DEFAULT '2026.18' NOT NULL,
	"generation_version" varchar(16) DEFAULT 'gear-v2' NOT NULL,
	"acquired_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gear_templates" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"slot" varchar(16) NOT NULL,
	"min_quality" integer DEFAULT 0 NOT NULL,
	"max_quality" integer DEFAULT 100 NOT NULL,
	"base_stat_range" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_biome_id" varchar(16),
	"min_rarity_index" integer DEFAULT 0 NOT NULL,
	"max_rarity_index" integer DEFAULT 6 NOT NULL,
	"upgrade_gold_base" bigint DEFAULT 1000 NOT NULL,
	"upgrade_gold_growth" real DEFAULT 1.6 NOT NULL,
	"upgrade_relic_base" integer DEFAULT 10 NOT NULL,
	"upgrade_relic_growth" real DEFAULT 1.4 NOT NULL,
	"salvage_relic_min" integer DEFAULT 0 NOT NULL,
	"salvage_relic_max" integer DEFAULT 0 NOT NULL,
	"can_reroll" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_buffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buff_type" varchar(16) NOT NULL,
	"bonus_basis_points" integer NOT NULL,
	"purchaser_id" uuid,
	"starts_at" timestamp DEFAULT now() NOT NULL,
	"ends_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(32) NOT NULL,
	"player_id" uuid NOT NULL,
	"fish_id" varchar(64),
	"quantity" integer DEFAULT 1 NOT NULL,
	"starts_at" timestamp DEFAULT now() NOT NULL,
	"ends_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"message" varchar(120) DEFAULT '' NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "guild_boosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"type" varchar(16) NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"purchased_units" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_members" (
	"guild_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"role" varchar(16) DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"total_donated_gold" bigint DEFAULT 0 NOT NULL,
	"total_tax_contributed" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "guild_members_guild_id_player_id_pk" PRIMARY KEY("guild_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "guild_name_style_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"mode" varchar(16) NOT NULL,
	"colors" jsonb DEFAULT '[]'::jsonb,
	"cost_gold" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_totems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"type" varchar(16) NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"upgrade_cost" bigint DEFAULT 100000 NOT NULL,
	"donated_gold" bigint DEFAULT 0 NOT NULL,
	"activated_until" timestamp,
	"activation_cost_gold" bigint DEFAULT 100000 NOT NULL,
	"boost_cost_gold" bigint DEFAULT 500000 NOT NULL,
	"boost_duration_minutes" integer DEFAULT 30 NOT NULL,
	"boost_max_units" integer DEFAULT 48 NOT NULL,
	"boosted_units" integer DEFAULT 0 NOT NULL,
	"boost_starts_at" timestamp,
	"boost_ends_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(24) NOT NULL,
	"tag" varchar(8) NOT NULL,
	"public_description" varchar(120) DEFAULT '暂无公开介绍' NOT NULL,
	"announcement" varchar(120) DEFAULT '' NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"experience" bigint DEFAULT 0 NOT NULL,
	"tax_rate_percent" integer DEFAULT 0 NOT NULL,
	"treasury_gold" bigint DEFAULT 0 NOT NULL,
	"leader_id" uuid NOT NULL,
	"name_style_mode" varchar(16) DEFAULT 'default' NOT NULL,
	"name_style_colors" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "guilds_name_unique" UNIQUE("name"),
	CONSTRAINT "guilds_tag_unique" UNIQUE("tag")
);
--> statement-breakpoint
CREATE TABLE "leaderboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" varchar(32) NOT NULL,
	"date" varchar(10) NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"entries" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"asset_type" varchar(16) NOT NULL,
	"side" varchar(8) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"limit_unit_price" bigint NOT NULL,
	"initial_quantity" bigint NOT NULL,
	"remaining_quantity" bigint NOT NULL,
	"gross_filled" bigint DEFAULT 0 NOT NULL,
	"fee_charged" bigint DEFAULT 0 NOT NULL,
	"fee_basis_points" integer DEFAULT 500 NOT NULL,
	"fish_id" varchar(64),
	"gear_id" uuid,
	"item_type" varchar(32),
	"escrow_gold" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"filled_at" timestamp,
	"cancelled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "market_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_type" varchar(16) NOT NULL,
	"fish_id" varchar(64),
	"unit_price" bigint NOT NULL,
	"quantity" bigint NOT NULL,
	"seller_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_order_id" uuid,
	"buyer_order_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mastery_targets" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"biome_id" varchar(16) NOT NULL,
	"rarity" varchar(16) NOT NULL,
	"fish_id" varchar(64) NOT NULL,
	"level_index" integer DEFAULT 0 NOT NULL,
	"required_quantity" bigint NOT NULL,
	"xp_bonus_basis_points" integer DEFAULT 250 NOT NULL,
	"direct_gold_bonus_basis_points" integer DEFAULT 250 NOT NULL,
	"max_level" integer DEFAULT 5 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_boat_crowdfunding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"boat_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"gold" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_boat_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"boat_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_boat_members" (
	"boat_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"role" varchar(16) DEFAULT 'crew' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "party_boat_members_boat_id_player_id_pk" PRIMARY KEY("boat_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "party_boats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"captain_id" uuid NOT NULL,
	"name" varchar(24) DEFAULT '无名之船' NOT NULL,
	"boat_definition_id" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"visibility" varchar(16) DEFAULT 'public' NOT NULL,
	"join_code" varchar(8) NOT NULL,
	"biome_id" varchar(16) DEFAULT 'b_001' NOT NULL,
	"helm_id" uuid,
	"treasury_gold" bigint DEFAULT 0 NOT NULL,
	"rental_ends_at" timestamp,
	"maintenance_due_at" timestamp,
	"upkeep_paid_at" timestamp,
	"is_permanent" boolean DEFAULT false NOT NULL,
	"crowdfunding_gold" bigint DEFAULT 0 NOT NULL,
	"crowdfunding_target" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "party_boats_join_code_unique" UNIQUE("join_code")
);
--> statement-breakpoint
CREATE TABLE "player_achievements" (
	"player_id" uuid NOT NULL,
	"achievement_id" varchar(64) NOT NULL,
	"progress" bigint DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'in_progress' NOT NULL,
	"claimed_at" timestamp,
	CONSTRAINT "player_achievements_player_id_achievement_id_pk" PRIMARY KEY("player_id","achievement_id")
);
--> statement-breakpoint
CREATE TABLE "player_avatars" (
	"player_id" uuid NOT NULL,
	"avatar_id" varchar(64) NOT NULL,
	"unlocked_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "player_avatars_player_id_avatar_id_pk" PRIMARY KEY("player_id","avatar_id")
);
--> statement-breakpoint
CREATE TABLE "player_baits" (
	"player_id" uuid NOT NULL,
	"bait_id" varchar(32) NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"auto_refill" boolean DEFAULT false NOT NULL,
	"auto_refill_quantity" integer DEFAULT 100 NOT NULL,
	CONSTRAINT "player_baits_player_id_bait_id_pk" PRIMARY KEY("player_id","bait_id")
);
--> statement-breakpoint
CREATE TABLE "player_biomes" (
	"player_id" uuid NOT NULL,
	"biome_id" varchar(16) NOT NULL,
	"is_unlocked" boolean DEFAULT false NOT NULL,
	"unlocked_at" timestamp,
	"mastery_xp" bigint DEFAULT 0 NOT NULL,
	"mastery_level" integer DEFAULT 0 NOT NULL,
	"xp_bonus_basis_points" integer DEFAULT 0 NOT NULL,
	"direct_gold_basis_points" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "player_biomes_player_id_biome_id_pk" PRIMARY KEY("player_id","biome_id")
);
--> statement-breakpoint
CREATE TABLE "player_buffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"source" varchar(32) DEFAULT 'player_shop' NOT NULL,
	"buff_type" varchar(16) NOT NULL,
	"bonus_basis_points" integer NOT NULL,
	"starts_at" timestamp DEFAULT now() NOT NULL,
	"ends_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_chests" (
	"player_id" uuid NOT NULL,
	"chest_id" varchar(64) NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"opened_count" bigint DEFAULT 0 NOT NULL,
	"arcane_chests_since_arcane_gear" integer DEFAULT 0 NOT NULL,
	"purchased_today" integer DEFAULT 0 NOT NULL,
	"last_purchase_date" varchar(10),
	CONSTRAINT "player_chests_player_id_chest_id_pk" PRIMARY KEY("player_id","chest_id")
);
--> statement-breakpoint
CREATE TABLE "player_inventory_fish" (
	"player_id" uuid NOT NULL,
	"fish_id" varchar(64) NOT NULL,
	"quantity" bigint DEFAULT 0 NOT NULL,
	"total_caught" bigint DEFAULT 0 NOT NULL,
	"first_caught_at" timestamp,
	"last_caught_at" timestamp,
	"is_locked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "player_inventory_fish_player_id_fish_id_pk" PRIMARY KEY("player_id","fish_id")
);
--> statement-breakpoint
CREATE TABLE "player_login_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"ip" varchar(64),
	"user_agent" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_mastery_progress" (
	"player_id" uuid NOT NULL,
	"target_id" varchar(64) NOT NULL,
	"completed_level" integer DEFAULT 0 NOT NULL,
	"contributed_quantity" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "player_mastery_progress_player_id_target_id_pk" PRIMARY KEY("player_id","target_id")
);
--> statement-breakpoint
CREATE TABLE "player_notifications_read" (
	"player_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"read_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "player_notifications_read_player_id_notification_id_pk" PRIMARY KEY("player_id","notification_id")
);
--> statement-breakpoint
CREATE TABLE "player_quests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"period" varchar(16) NOT NULL,
	"period_key" varchar(24) NOT NULL,
	"slot" integer NOT NULL,
	"template_id" varchar(64),
	"category" varchar(32) NOT NULL,
	"objective_type" varchar(64) NOT NULL,
	"description" varchar(255) NOT NULL,
	"target" bigint NOT NULL,
	"progress" bigint DEFAULT 0 NOT NULL,
	"reward_relics" integer DEFAULT 0 NOT NULL,
	"reward_gold" bigint DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'in_progress' NOT NULL,
	"biome_id" varchar(16),
	"biome_name" varchar(32),
	"is_biome_unlocked" boolean,
	"weather_id" varchar(32),
	"weather_name" varchar(32),
	"bait_id" varchar(32),
	"bait_name" varchar(32),
	"rarity" varchar(16),
	"rarity_name" varchar(16),
	"settlement_mode" varchar(16),
	"completed_at" timestamp,
	"claimed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_rods" (
	"player_id" uuid NOT NULL,
	"rod_id" varchar(64) NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"is_owned" boolean DEFAULT false NOT NULL,
	"invested_gold" bigint DEFAULT 0 NOT NULL,
	"upgrade_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "player_rods_player_id_rod_id_pk" PRIMARY KEY("player_id","rod_id")
);
--> statement-breakpoint
CREATE TABLE "player_stat_allocation_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"allocation" jsonb NOT NULL,
	"cost_gold" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_talents" (
	"player_id" uuid NOT NULL,
	"talent_id" varchar(64) NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "player_talents_player_id_talent_id_pk" PRIMARY KEY("player_id","talent_id")
);
--> statement-breakpoint
CREATE TABLE "player_trophies" (
	"player_id" uuid NOT NULL,
	"trophy_id" varchar(64) NOT NULL,
	"earned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "player_trophies_player_id_trophy_id_pk" PRIMARY KEY("player_id","trophy_id")
);
--> statement-breakpoint
CREATE TABLE "player_weekly_medals" (
	"player_id" uuid NOT NULL,
	"medal_id" varchar(64) NOT NULL,
	"cycle_sequence" integer NOT NULL,
	"rank" integer NOT NULL,
	"earned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "player_weekly_medals_player_id_medal_id_cycle_sequence_pk" PRIMARY KEY("player_id","medal_id","cycle_sequence")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"public_id" integer NOT NULL,
	"nickname" varchar(24) NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"experience" bigint DEFAULT 0 NOT NULL,
	"gold" bigint DEFAULT 0 NOT NULL,
	"relics" bigint DEFAULT 0 NOT NULL,
	"fragments" bigint DEFAULT 0 NOT NULL,
	"unspent_stat_points" integer DEFAULT 0 NOT NULL,
	"free_rod_reset_credits" integer DEFAULT 1 NOT NULL,
	"current_biome_id" varchar(16) DEFAULT 'b_001' NOT NULL,
	"equipped_rod_id" varchar(64) DEFAULT 'novice_rod' NOT NULL,
	"selected_bait_id" varchar(32) DEFAULT 'bait_basic' NOT NULL,
	"equipped_title_id" varchar(64),
	"avatar_id" varchar(64) DEFAULT 'moonfall-scout' NOT NULL,
	"name_style_mode" varchar(16) DEFAULT 'default' NOT NULL,
	"name_style_colors" jsonb DEFAULT '[]'::jsonb,
	"name_style_angle" integer,
	"equipped_fish_showcase_id" varchar(64),
	"showcase_fish_ids" jsonb DEFAULT '[]'::jsonb,
	"achievement_showcase_ids" jsonb DEFAULT '[]'::jsonb,
	"base_strength" integer DEFAULT 0 NOT NULL,
	"base_intelligence" integer DEFAULT 0 NOT NULL,
	"base_luck" integer DEFAULT 0 NOT NULL,
	"base_endurance" integer DEFAULT 100 NOT NULL,
	"gold_penalty_total" bigint DEFAULT 0 NOT NULL,
	"acknowledged_gold_penalty_total" bigint DEFAULT 0 NOT NULL,
	"market_access_status" varchar(16) DEFAULT 'enabled' NOT NULL,
	"total_casts" bigint DEFAULT 0 NOT NULL,
	"total_fish_caught" bigint DEFAULT 0 NOT NULL,
	"total_chests_opened" bigint DEFAULT 0 NOT NULL,
	"total_gear_upgrades" bigint DEFAULT 0 NOT NULL,
	"total_relic_drops" integer DEFAULT 0 NOT NULL,
	"total_relic_quantity" bigint DEFAULT 0 NOT NULL,
	"total_chests_dropped" bigint DEFAULT 0 NOT NULL,
	"total_gear_dropped" bigint DEFAULT 0 NOT NULL,
	"npc_fish_sold_quantity" bigint DEFAULT 0 NOT NULL,
	"npc_fish_sold_gold" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "players_account_id_unique" UNIQUE("account_id"),
	CONSTRAINT "players_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "quest_templates" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"period" varchar(16) NOT NULL,
	"slot" integer NOT NULL,
	"category" varchar(32) NOT NULL,
	"objective_type" varchar(64) NOT NULL,
	"description_template" varchar(255) NOT NULL,
	"target" bigint NOT NULL,
	"reward_relics" integer DEFAULT 0 NOT NULL,
	"reward_gold" bigint DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 10 NOT NULL,
	"biome_id" varchar(16),
	"weather_id" varchar(32),
	"bait_tier" varchar(16),
	"rarity" varchar(16),
	"settlement_mode" varchar(16),
	"fish_id" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "rods" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" varchar(255) NOT NULL,
	"required_level" integer NOT NULL,
	"purchase_cost" bigint NOT NULL,
	"base_upgrade_cost" bigint DEFAULT 0 NOT NULL,
	"upgrade_cost_growth" real DEFAULT 1 NOT NULL,
	"max_level" integer NOT NULL,
	"stat_per_level" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"special_effect" jsonb DEFAULT 'null'::jsonb,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_buffs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" varchar(128) NOT NULL,
	"shop" varchar(16) NOT NULL,
	"currency" varchar(16) NOT NULL,
	"product_type" varchar(16) NOT NULL,
	"price" bigint NOT NULL,
	"buff_category" varchar(16) NOT NULL,
	"bonus_basis_points" integer NOT NULL,
	"duration_seconds" integer NOT NULL,
	"is_global" boolean DEFAULT false NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sponsorship_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"source" varchar(64) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talents" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" varchar(255) NOT NULL,
	"effect_kind" varchar(64) NOT NULL,
	"effect_per_rank" jsonb NOT NULL,
	"max_rank" integer DEFAULT 10 NOT NULL,
	"prerequisite_talent_id" varchar(64),
	"prerequisite_rank" integer,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "titles" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" varchar(255) NOT NULL,
	"image_path" varchar(255) DEFAULT '' NOT NULL,
	"text_color" varchar(16),
	"background_color" varchar(16),
	"border_color" varchar(16),
	"border_effect" varchar(16),
	"is_internal" boolean DEFAULT false NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_catch_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"guild_id" uuid,
	"fish_id" varchar(64) NOT NULL,
	"points" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"caught_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"guild_id" uuid,
	"group_id" varchar(16),
	"score" bigint DEFAULT 0 NOT NULL,
	"rank" integer,
	"registered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_trophies" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"all_stat_bonus" integer DEFAULT 0 NOT NULL,
	"image_path" varchar(255) DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(16) NOT NULL,
	"sequence" integer NOT NULL,
	"status" varchar(16) DEFAULT 'scheduled' NOT NULL,
	"biome_id" varchar(16) NOT NULL,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"minimum_guilds" integer DEFAULT 1 NOT NULL,
	"registered_guild_count" integer DEFAULT 0 NOT NULL,
	"targets" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weather" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(32) NOT NULL,
	"effect" varchar(128) NOT NULL,
	"refresh_weight" integer DEFAULT 1 NOT NULL,
	"xp_multiplier" real DEFAULT 1 NOT NULL,
	"quantity_bonus" integer DEFAULT 0 NOT NULL,
	"gear_category_multiplier" real DEFAULT 1 NOT NULL,
	"relic_category_multiplier" real DEFAULT 1 NOT NULL,
	"rarity_multipliers" jsonb DEFAULT '{}'::jsonb,
	"direct_gold_range_bonus" jsonb DEFAULT 'null'::jsonb,
	"excluded_biome_ids" jsonb DEFAULT '[]'::jsonb,
	"rarity_display_percentages" jsonb DEFAULT '{}'::jsonb,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_tournament_catch_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_sequence" integer NOT NULL,
	"group_public_id" integer NOT NULL,
	"player_id" uuid NOT NULL,
	"fish_id" varchar(64) NOT NULL,
	"points" integer NOT NULL,
	"caught_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_tournament_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_sequence" integer NOT NULL,
	"group_public_id" integer NOT NULL,
	"player_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_tournament_medals" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"all_stat_bonus" integer DEFAULT 0 NOT NULL,
	"image_path" varchar(255) DEFAULT '' NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arcane_sacrifice_contributions" ADD CONSTRAINT "arcane_sacrifice_contributions_round_id_arcane_sacrifice_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."arcane_sacrifice_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arcane_sacrifice_contributions" ADD CONSTRAINT "arcane_sacrifice_contributions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barter_offers" ADD CONSTRAINT "barter_offers_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barter_trades" ADD CONSTRAINT "barter_trades_offer_id_barter_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."barter_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barter_trades" ADD CONSTRAINT "barter_trades_giver_id_players_id_fk" FOREIGN KEY ("giver_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barter_trades" ADD CONSTRAINT "barter_trades_receiver_id_players_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cdk_redemptions" ADD CONSTRAINT "cdk_redemptions_code_cdk_codes_code_fk" FOREIGN KEY ("code") REFERENCES "public"."cdk_codes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cdk_redemptions" ADD CONSTRAINT "cdk_redemptions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convenience_entitlements" ADD CONSTRAINT "convenience_entitlements_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convenience_purchases" ADD CONSTRAINT "convenience_purchases_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_check_ins" ADD CONSTRAINT "daily_check_ins_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_harvest" ADD CONSTRAINT "daily_harvest_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fish" ADD CONSTRAINT "fish_biome_id_biomes_id_fk" FOREIGN KEY ("biome_id") REFERENCES "public"."biomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fishing_runs" ADD CONSTRAINT "fishing_runs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gear_items" ADD CONSTRAINT "gear_items_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gear_items" ADD CONSTRAINT "gear_items_template_id_gear_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."gear_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_buffs" ADD CONSTRAINT "global_buffs_purchaser_id_players_id_fk" FOREIGN KEY ("purchaser_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_notifications" ADD CONSTRAINT "global_notifications_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_applications" ADD CONSTRAINT "guild_applications_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_applications" ADD CONSTRAINT "guild_applications_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_boosts" ADD CONSTRAINT "guild_boosts_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_name_style_logs" ADD CONSTRAINT "guild_name_style_logs_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_totems" ADD CONSTRAINT "guild_totems_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_leader_id_players_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_trades" ADD CONSTRAINT "market_trades_seller_id_players_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_trades" ADD CONSTRAINT "market_trades_buyer_id_players_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_targets" ADD CONSTRAINT "mastery_targets_biome_id_biomes_id_fk" FOREIGN KEY ("biome_id") REFERENCES "public"."biomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mastery_targets" ADD CONSTRAINT "mastery_targets_fish_id_fish_id_fk" FOREIGN KEY ("fish_id") REFERENCES "public"."fish"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_boat_crowdfunding" ADD CONSTRAINT "party_boat_crowdfunding_boat_id_party_boats_id_fk" FOREIGN KEY ("boat_id") REFERENCES "public"."party_boats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_boat_crowdfunding" ADD CONSTRAINT "party_boat_crowdfunding_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_boat_invitations" ADD CONSTRAINT "party_boat_invitations_boat_id_party_boats_id_fk" FOREIGN KEY ("boat_id") REFERENCES "public"."party_boats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_boat_invitations" ADD CONSTRAINT "party_boat_invitations_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_boat_members" ADD CONSTRAINT "party_boat_members_boat_id_party_boats_id_fk" FOREIGN KEY ("boat_id") REFERENCES "public"."party_boats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_boat_members" ADD CONSTRAINT "party_boat_members_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_boats" ADD CONSTRAINT "party_boats_captain_id_players_id_fk" FOREIGN KEY ("captain_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_achievements" ADD CONSTRAINT "player_achievements_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_achievements" ADD CONSTRAINT "player_achievements_achievement_id_achievement_definitions_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievement_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_avatars" ADD CONSTRAINT "player_avatars_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_avatars" ADD CONSTRAINT "player_avatars_avatar_id_avatars_id_fk" FOREIGN KEY ("avatar_id") REFERENCES "public"."avatars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_baits" ADD CONSTRAINT "player_baits_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_baits" ADD CONSTRAINT "player_baits_bait_id_baits_id_fk" FOREIGN KEY ("bait_id") REFERENCES "public"."baits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_biomes" ADD CONSTRAINT "player_biomes_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_biomes" ADD CONSTRAINT "player_biomes_biome_id_biomes_id_fk" FOREIGN KEY ("biome_id") REFERENCES "public"."biomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_buffs" ADD CONSTRAINT "player_buffs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_chests" ADD CONSTRAINT "player_chests_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_chests" ADD CONSTRAINT "player_chests_chest_id_chests_id_fk" FOREIGN KEY ("chest_id") REFERENCES "public"."chests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_inventory_fish" ADD CONSTRAINT "player_inventory_fish_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_inventory_fish" ADD CONSTRAINT "player_inventory_fish_fish_id_fish_id_fk" FOREIGN KEY ("fish_id") REFERENCES "public"."fish"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_login_logs" ADD CONSTRAINT "player_login_logs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_mastery_progress" ADD CONSTRAINT "player_mastery_progress_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_mastery_progress" ADD CONSTRAINT "player_mastery_progress_target_id_mastery_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."mastery_targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_notifications_read" ADD CONSTRAINT "player_notifications_read_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_notifications_read" ADD CONSTRAINT "player_notifications_read_notification_id_global_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."global_notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_quests" ADD CONSTRAINT "player_quests_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_rods" ADD CONSTRAINT "player_rods_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_rods" ADD CONSTRAINT "player_rods_rod_id_rods_id_fk" FOREIGN KEY ("rod_id") REFERENCES "public"."rods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_stat_allocation_logs" ADD CONSTRAINT "player_stat_allocation_logs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_talents" ADD CONSTRAINT "player_talents_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_talents" ADD CONSTRAINT "player_talents_talent_id_talents_id_fk" FOREIGN KEY ("talent_id") REFERENCES "public"."talents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trophies" ADD CONSTRAINT "player_trophies_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_trophies" ADD CONSTRAINT "player_trophies_trophy_id_tournament_trophies_id_fk" FOREIGN KEY ("trophy_id") REFERENCES "public"."tournament_trophies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_weekly_medals" ADD CONSTRAINT "player_weekly_medals_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_weekly_medals" ADD CONSTRAINT "player_weekly_medals_medal_id_weekly_tournament_medals_id_fk" FOREIGN KEY ("medal_id") REFERENCES "public"."weekly_tournament_medals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsorship_credits" ADD CONSTRAINT "sponsorship_credits_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_catch_events" ADD CONSTRAINT "tournament_catch_events_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_catch_events" ADD CONSTRAINT "tournament_catch_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_tournament_catch_events" ADD CONSTRAINT "weekly_tournament_catch_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_tournament_groups" ADD CONSTRAINT "weekly_tournament_groups_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sacrifice_contrib_round_idx" ON "arcane_sacrifice_contributions" USING btree ("round_id","player_id");--> statement-breakpoint
CREATE INDEX "fishing_runs_player_idx" ON "fishing_runs" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lb_cat_date" ON "leaderboard_snapshots" USING btree ("category","date");--> statement-breakpoint
CREATE INDEX "market_orders_asset_idx" ON "market_orders" USING btree ("asset_type","status");--> statement-breakpoint
CREATE INDEX "market_orders_fish_idx" ON "market_orders" USING btree ("fish_id");--> statement-breakpoint
CREATE INDEX "market_trades_asset_idx" ON "market_trades" USING btree ("asset_type","fish_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_quest_period_slot" ON "player_quests" USING btree ("player_id","period","period_key","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "quest_tpl_period_slot" ON "quest_templates" USING btree ("period","slot");--> statement-breakpoint
CREATE INDEX "tournament_catch_idx" ON "tournament_catch_events" USING btree ("tournament_id","player_id");