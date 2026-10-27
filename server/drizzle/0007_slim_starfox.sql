CREATE TABLE "admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" varchar(64) DEFAULT 'admin' NOT NULL,
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" varchar(128),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lighthouse_artifacts" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" varchar(255) NOT NULL,
	"stat_type" varchar(16) NOT NULL,
	"base_bonus" integer DEFAULT 1 NOT NULL,
	"max_level" integer DEFAULT 20 NOT NULL,
	"upgrade_relic_base" integer DEFAULT 10 NOT NULL,
	"upgrade_relic_growth" real DEFAULT 1.5 NOT NULL,
	"icon" varchar(32) DEFAULT 'sparkles' NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lighthouse_lottery_draws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"cost_relics" integer DEFAULT 0 NOT NULL,
	"reward_type" varchar(32) NOT NULL,
	"reward_id" varchar(64),
	"reward_amount" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_artifacts" (
	"player_id" uuid NOT NULL,
	"artifact_id" varchar(64) NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"acquired_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "player_artifacts_player_id_artifact_id_pk" PRIMARY KEY("player_id","artifact_id")
);
--> statement-breakpoint
CREATE TABLE "player_reincarnations" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"strength_points" integer DEFAULT 0 NOT NULL,
	"intelligence_points" integer DEFAULT 0 NOT NULL,
	"luck_points" integer DEFAULT 0 NOT NULL,
	"endurance_points" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_boss_damage" (
	"boss_id" varchar(64) NOT NULL,
	"player_id" uuid NOT NULL,
	"damage" bigint DEFAULT 0 NOT NULL,
	"attacks" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "world_boss_damage_boss_id_player_id_pk" PRIMARY KEY("boss_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "world_bosses" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" varchar(255) NOT NULL,
	"biome_id" varchar(16) NOT NULL,
	"max_hp" bigint NOT NULL,
	"current_hp" bigint NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"status" varchar(16) DEFAULT 'scheduled' NOT NULL,
	"reward_relics" integer DEFAULT 0 NOT NULL,
	"reward_fragments" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lighthouse_lottery_draws" ADD CONSTRAINT "lighthouse_lottery_draws_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_artifacts" ADD CONSTRAINT "player_artifacts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_artifacts" ADD CONSTRAINT "player_artifacts_artifact_id_lighthouse_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."lighthouse_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_reincarnations" ADD CONSTRAINT "player_reincarnations_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_boss_damage" ADD CONSTRAINT "world_boss_damage_boss_id_world_bosses_id_fk" FOREIGN KEY ("boss_id") REFERENCES "public"."world_bosses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_boss_damage" ADD CONSTRAINT "world_boss_damage_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_time_idx" ON "admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "lighthouse_draws_player_idx" ON "lighthouse_lottery_draws" USING btree ("player_id","created_at");