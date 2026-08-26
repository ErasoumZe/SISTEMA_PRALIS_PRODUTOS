CREATE TABLE "produto_creare" (
	"id" text PRIMARY KEY NOT NULL,
	"loja" text NOT NULL,
	"produto_codigo" text NOT NULL,
	"product_id" text NOT NULL,
	"confirmado_por" text,
	"confirmado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "produto_creare" ADD CONSTRAINT "produto_creare_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_produto_creare_natural" ON "produto_creare" USING btree ("loja","produto_codigo");--> statement-breakpoint
CREATE INDEX "idx_produto_creare_produto" ON "produto_creare" USING btree ("product_id");