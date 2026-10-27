CREATE TABLE "exchange_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"gold_cost" bigint DEFAULT 0 NOT NULL,
	"date" varchar(10) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exchange_logs" ADD CONSTRAINT "exchange_logs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exchange_logs_player_date" ON "exchange_logs" USING btree ("player_id","date");