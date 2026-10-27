CREATE TABLE "banned_players" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"reason" varchar(200) DEFAULT '' NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "banned_players" ADD CONSTRAINT "banned_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;