CREATE TABLE "sia_produto_depara" (
	"id" text PRIMARY KEY NOT NULL,
	"loja" text NOT NULL,
	"codigo_barras" text NOT NULL,
	"chave_barras" text NOT NULL,
	"coditem" text NOT NULL,
	"descricao" text DEFAULT '' NOT NULL,
	"cod_grupo" text DEFAULT '' NOT NULL,
	"aliq_saida_ecf" text DEFAULT '' NOT NULL,
	"reducao" numeric(7, 4),
	"cst_saida" text DEFAULT '' NOT NULL,
	"csosn" text DEFAULT '' NOT NULL,
	"ncm" text DEFAULT '' NOT NULL,
	"ativo" text DEFAULT '' NOT NULL,
	"importado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sia_depara_barras" ON "sia_produto_depara" USING btree ("loja","chave_barras");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sia_depara_coditem" ON "sia_produto_depara" USING btree ("loja","coditem");--> statement-breakpoint
CREATE INDEX "idx_sia_depara_loja" ON "sia_produto_depara" USING btree ("loja");