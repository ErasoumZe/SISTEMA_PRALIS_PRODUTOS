CREATE TABLE "venda_item_pdv" (
	"id" text PRIMARY KEY NOT NULL,
	"loja" text NOT NULL,
	"venda_id_erp" text NOT NULL,
	"item_id_erp" text NOT NULL,
	"dispositivo_id_erp" text NOT NULL,
	"pdv" text NOT NULL,
	"vendido_em" timestamp NOT NULL,
	"produto_id_erp" text DEFAULT '' NOT NULL,
	"produto_codigo" text DEFAULT '' NOT NULL,
	"produto" text NOT NULL,
	"quantidade" numeric(16, 3) NOT NULL,
	"valor_unitario" numeric(16, 2) NOT NULL,
	"total" numeric(16, 2) NOT NULL,
	"item_cancelado" boolean NOT NULL,
	"venda_status" text NOT NULL,
	"venda_confirmada" boolean NOT NULL,
	"origem_atualizada_em" timestamp NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fechamento_caixa_dia" ADD COLUMN "dispositivo_id_erp" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_venda_item_pdv_natural" ON "venda_item_pdv" USING btree ("loja","item_id_erp");--> statement-breakpoint
CREATE INDEX "idx_venda_item_pdv_loja_pdv_hora" ON "venda_item_pdv" USING btree ("loja","dispositivo_id_erp","vendido_em");--> statement-breakpoint
CREATE INDEX "idx_venda_item_pdv_loja_venda" ON "venda_item_pdv" USING btree ("loja","venda_id_erp");