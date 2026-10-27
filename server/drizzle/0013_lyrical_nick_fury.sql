ALTER TABLE "guilds" ADD COLUMN "recruitment_mode" varchar(16) DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "minimum_application_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "name_style_angle" integer DEFAULT 35 NOT NULL;