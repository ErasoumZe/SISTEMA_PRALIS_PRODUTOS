CREATE TABLE "unif_fonte_produto" (
	"id" text PRIMARY KEY NOT NULL,
	"fonte" text NOT NULL,
	"cod_interno" text DEFAULT '' NOT NULL,
	"cod_barras" text DEFAULT '' NOT NULL,
	"chave_barras" text DEFAULT '' NOT NULL,
	"nome" text DEFAULT '' NOT NULL,
	"nome_normalizado" text DEFAULT '' NOT NULL,
	"ativo" boolean,
	"grupo" text,
	"custo" numeric(16, 4),
	"venda" numeric(16, 4),
	"ncm" text,
	"cst" text,
	"csosn" text,
	"aliq_ecf" text,
	"reducao" numeric(9, 4),
	"aliq_interna" numeric(9, 4),
	"icms_efetivo" numeric(9, 4),
	"raw" jsonb NOT NULL,
	"carregado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_unif_fonte" ON "unif_fonte_produto" USING btree ("fonte");--> statement-breakpoint
CREATE INDEX "idx_unif_chave_barras" ON "unif_fonte_produto" USING btree ("chave_barras");--> statement-breakpoint
CREATE INDEX "idx_unif_nome_normalizado" ON "unif_fonte_produto" USING btree ("nome_normalizado");--> statement-breakpoint
CREATE INDEX "idx_unif_fonte_interno" ON "unif_fonte_produto" USING btree ("fonte","cod_interno");