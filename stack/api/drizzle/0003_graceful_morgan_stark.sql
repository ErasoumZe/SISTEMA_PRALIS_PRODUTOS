CREATE TABLE "product_sheet_sync" (
	"product_id" text PRIMARY KEY NOT NULL,
	"spreadsheet_id" text NOT NULL,
	"sheet_name" text NOT NULL,
	"row_number" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_sheet_sync" ADD CONSTRAINT "product_sheet_sync_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;