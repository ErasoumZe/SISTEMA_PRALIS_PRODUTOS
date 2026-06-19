ALTER TABLE "users" ADD COLUMN "reset_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reset_expires_at" timestamp with time zone;