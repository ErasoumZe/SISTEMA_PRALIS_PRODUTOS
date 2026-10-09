CREATE TABLE "meta_planilha_tnp_dia" (
	"id" text PRIMARY KEY NOT NULL,
	"data" date NOT NULL,
	"data_base" date NOT NULL,
	"estado" text NOT NULL,
	"base" numeric(16, 2),
	"ajuste_dia" numeric(8, 4),
	"crescimento_mes" numeric(8, 4),
	"pct_manha" numeric(8, 4),
	"modo" text NOT NULL,
	"casas_arredondamento" integer NOT NULL,
	"meta_total" numeric(16, 2) DEFAULT '0' NOT NULL,
	"meta_manha" numeric(16, 2) DEFAULT '0' NOT NULL,
	"meta_tarde" numeric(16, 2) DEFAULT '0' NOT NULL,
	"meta_tarde_planilha" numeric(16, 2) DEFAULT '0' NOT NULL,
	"planilha_id" text NOT NULL,
	"linha_planilha" integer NOT NULL,
	"lida_na_planilha_em" timestamp with time zone NOT NULL,
	"importado_por" text,
	"importado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_meta_planilha_tnp_dia" ON "meta_planilha_tnp_dia" USING btree ("data");--> statement-breakpoint
CREATE INDEX "idx_meta_planilha_tnp_data" ON "meta_planilha_tnp_dia" USING btree ("data");