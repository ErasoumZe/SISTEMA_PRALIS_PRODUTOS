CREATE TABLE "venda_creare" (
	"id" text PRIMARY KEY NOT NULL,
	"loja" text NOT NULL,
	"venda_id_erp" text NOT NULL,
	"dispositivo_id_erp" text NOT NULL,
	"pdv" text NOT NULL,
	"vendido_em" timestamp NOT NULL,
	"status" text NOT NULL,
	"valor_subtotal" numeric(16, 2) NOT NULL,
	"valor_desconto" numeric(16, 2) NOT NULL,
	"valor_acrescimo" numeric(16, 2) NOT NULL,
	"valor_total" numeric(16, 2) NOT NULL,
	"valor_pago" numeric(16, 2) NOT NULL,
	"pagamentos" jsonb NOT NULL,
	"conteudo_hash" text NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_venda_creare_natural" ON "venda_creare" USING btree ("loja","venda_id_erp");--> statement-breakpoint
CREATE INDEX "idx_venda_creare_loja_hora_pdv" ON "venda_creare" USING btree ("loja","vendido_em","dispositivo_id_erp");