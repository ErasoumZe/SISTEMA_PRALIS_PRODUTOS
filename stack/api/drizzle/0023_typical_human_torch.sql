CREATE TABLE "product_name_history" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"loja" text NOT NULL,
	"codigo" text NOT NULL,
	"codigo_interno" text,
	"nome_anterior" text NOT NULL,
	"nome_novo" text NOT NULL,
	"alterado_por_user_id" text,
	"alterado_por_nome" text,
	"alterado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_name_history" ADD CONSTRAINT "product_name_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_name_history" ADD CONSTRAINT "product_name_history_alterado_por_user_id_users_id_fk" FOREIGN KEY ("alterado_por_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_product_name_history_alterado_em" ON "product_name_history" USING btree ("alterado_em");--> statement-breakpoint
CREATE INDEX "idx_product_name_history_product" ON "product_name_history" USING btree ("product_id");