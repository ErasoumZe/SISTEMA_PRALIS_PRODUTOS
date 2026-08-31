CREATE TABLE "product_merge" (
	"id" text PRIMARY KEY NOT NULL,
	"loja" text NOT NULL,
	"vencedor_product_id" text NOT NULL,
	"perdedor_product_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"confirmado_por" text,
	"confirmado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "unificado_em_product_id" text;--> statement-breakpoint
CREATE INDEX "idx_product_merge_vencedor" ON "product_merge" USING btree ("vencedor_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_product_merge_perdedor" ON "product_merge" USING btree ("perdedor_product_id");