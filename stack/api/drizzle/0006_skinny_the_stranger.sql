CREATE TABLE "fechamento_caixa_dia" (
	"id" text PRIMARY KEY NOT NULL,
	"loja" text NOT NULL,
	"data" date NOT NULL,
	"pdv" text NOT NULL,
	"operador" text NOT NULL,
	"natureza" text NOT NULL,
	"caixa" text,
	"turno" text,
	"primeira_venda" timestamp NOT NULL,
	"ultima_venda" timestamp NOT NULL,
	"numero_vendas" integer NOT NULL,
	"crediario" numeric(16, 2) DEFAULT '0' NOT NULL,
	"credito" numeric(16, 2) DEFAULT '0' NOT NULL,
	"debito" numeric(16, 2) DEFAULT '0' NOT NULL,
	"dinheiro" numeric(16, 2) DEFAULT '0' NOT NULL,
	"pix" numeric(16, 2) DEFAULT '0' NOT NULL,
	"voucher" numeric(16, 2) DEFAULT '0' NOT NULL,
	"clientes" numeric(16, 2) DEFAULT '0' NOT NULL,
	"colaboradores" numeric(16, 2) DEFAULT '0' NOT NULL,
	"alimentacao" numeric(16, 2) DEFAULT '0' NOT NULL,
	"roubo_furto" numeric(16, 2) DEFAULT '0' NOT NULL,
	"socios" numeric(16, 2) DEFAULT '0' NOT NULL,
	"sobra_perda" numeric(16, 2) DEFAULT '0' NOT NULL,
	"outros" numeric(16, 2) DEFAULT '0' NOT NULL,
	"total_pagamento" numeric(16, 2) NOT NULL,
	"hash" text NOT NULL,
	"origem_atualizada_em" timestamp NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venda_produto_dia" (
	"id" text PRIMARY KEY NOT NULL,
	"loja" text NOT NULL,
	"data" date NOT NULL,
	"produto_codigo" text DEFAULT '' NOT NULL,
	"produto" text NOT NULL,
	"quantidade" numeric(16, 3) NOT NULL,
	"valor_unitario" numeric(16, 2) NOT NULL,
	"total" numeric(16, 2) NOT NULL,
	"hash" text NOT NULL,
	"origem_atualizada_em" timestamp NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_fechamento_caixa_dia_natural" ON "fechamento_caixa_dia" USING btree ("loja","data","pdv","operador");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_fechamento_caixa_dia_hash" ON "fechamento_caixa_dia" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "idx_fechamento_caixa_dia_loja_data" ON "fechamento_caixa_dia" USING btree ("loja","data");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_venda_produto_dia_natural" ON "venda_produto_dia" USING btree ("loja","data","produto_codigo","produto");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_venda_produto_dia_hash" ON "venda_produto_dia" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "idx_venda_produto_dia_loja_data" ON "venda_produto_dia" USING btree ("loja","data");