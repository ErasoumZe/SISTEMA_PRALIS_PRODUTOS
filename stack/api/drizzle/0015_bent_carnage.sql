CREATE TABLE "unif_decisao" (
	"id" text PRIMARY KEY NOT NULL,
	"grupo_chave" text NOT NULL,
	"acao" text NOT NULL,
	"product_id" text,
	"detalhe" jsonb NOT NULL,
	"usuario_id" text,
	"usuario_nome" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_unif_decisao_chave" ON "unif_decisao" USING btree ("grupo_chave");--> statement-breakpoint
CREATE INDEX "idx_unif_decisao_produto" ON "unif_decisao" USING btree ("product_id");