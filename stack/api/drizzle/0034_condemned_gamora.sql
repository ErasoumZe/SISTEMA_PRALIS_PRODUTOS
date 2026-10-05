CREATE TABLE "meta_dia_semana" (
	"id" text PRIMARY KEY NOT NULL,
	"versao_id" text NOT NULL,
	"dia_semana" integer NOT NULL,
	"ocorrencias" integer NOT NULL,
	"referencia_media" numeric(16, 2) NOT NULL,
	"pct_manha" numeric(6, 4) NOT NULL,
	"meta" numeric(16, 2) NOT NULL,
	"meta_manha" numeric(16, 2) NOT NULL,
	"meta_tarde" numeric(16, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_versao" (
	"id" text PRIMARY KEY NOT NULL,
	"loja" text NOT NULL,
	"vigencia_inicio" date NOT NULL,
	"crescimento" numeric(6, 4) NOT NULL,
	"referencia_inicio" date NOT NULL,
	"referencia_fim" date NOT NULL,
	"observacao" text,
	"criado_por" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meta_dia_semana" ADD CONSTRAINT "meta_dia_semana_versao_id_meta_versao_id_fk" FOREIGN KEY ("versao_id") REFERENCES "public"."meta_versao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_meta_dia_semana" ON "meta_dia_semana" USING btree ("versao_id","dia_semana");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_meta_versao_vigencia" ON "meta_versao" USING btree ("loja","vigencia_inicio");--> statement-breakpoint
CREATE INDEX "idx_meta_versao_loja_vigencia" ON "meta_versao" USING btree ("loja","vigencia_inicio");