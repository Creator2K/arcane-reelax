CREATE TABLE "player_bait_casts" (
	"player_id" uuid NOT NULL,
	"bait_id" varchar(32) NOT NULL,
	"casts" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "player_bait_casts_player_id_bait_id_pk" PRIMARY KEY("player_id","bait_id")
);
--> statement-breakpoint
CREATE TABLE "player_biome_casts" (
	"player_id" uuid NOT NULL,
	"biome_id" varchar(16) NOT NULL,
	"casts" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "player_biome_casts_player_id_biome_id_pk" PRIMARY KEY("player_id","biome_id")
);
--> statement-breakpoint
CREATE TABLE "player_stats" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"online_casts" bigint DEFAULT 0 NOT NULL,
	"offline_casts" bigint DEFAULT 0 NOT NULL,
	"login_days" integer DEFAULT 0 NOT NULL,
	"last_login_date" varchar(10),
	"market_trades" bigint DEFAULT 0 NOT NULL,
	"personal_tournaments" integer DEFAULT 0 NOT NULL,
	"guild_tournaments" integer DEFAULT 0 NOT NULL,
	"mastery_levels_gained" integer DEFAULT 0 NOT NULL,
	"rod_levels_gained" integer DEFAULT 0 NOT NULL,
	"first_legendary_at" timestamp,
	"first_mythic_at" timestamp,
	"first_exotic_at" timestamp,
	"first_arcane_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "player_weather_casts" (
	"player_id" uuid NOT NULL,
	"weather_id" varchar(32) NOT NULL,
	"casts" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "player_weather_casts_player_id_weather_id_pk" PRIMARY KEY("player_id","weather_id")
);
--> statement-breakpoint
ALTER TABLE "player_bait_casts" ADD CONSTRAINT "player_bait_casts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_biome_casts" ADD CONSTRAINT "player_biome_casts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_weather_casts" ADD CONSTRAINT "player_weather_casts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;