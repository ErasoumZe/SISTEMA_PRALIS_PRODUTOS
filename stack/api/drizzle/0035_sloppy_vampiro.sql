CREATE TABLE "fator_pontos_versao" (
	"id" text PRIMARY KEY NOT NULL,
	"loja" text NOT NULL,
	"vigencia_inicio" date NOT NULL,
	"faturamento" numeric(12, 6) NOT NULL,
	"ticket_medio" numeric(12, 6) NOT NULL,
	"ticket_em_pontos" boolean DEFAULT false NOT NULL,
	"observacao" text,
	"criado_por" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_fator_pontos_vigencia" ON "fator_pontos_versao" USING btree ("loja","vigencia_inicio");--> statement-breakpoint
CREATE INDEX "idx_fator_pontos_loja_vigencia" ON "fator_pontos_versao" USING btree ("loja","vigencia_inicio");