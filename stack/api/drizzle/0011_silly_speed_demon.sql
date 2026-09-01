CREATE TABLE "product_merge_recusa" (
	"id" text PRIMARY KEY NOT NULL,
	"loja" text NOT NULL,
	"produto_a_id" text NOT NULL,
	"produto_b_id" text NOT NULL,
	"recusado_por" text,
	"recusado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_product_merge_recusa_par" ON "product_merge_recusa" USING btree ("produto_a_id","produto_b_id");