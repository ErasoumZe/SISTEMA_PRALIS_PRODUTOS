CREATE TABLE "unif_grupo" (
	"id" text PRIMARY KEY NOT NULL,
	"chave" text NOT NULL,
	"motivo" text NOT NULL,
	"fontes" text[] NOT NULL,
	"lojas" text[] NOT NULL,
	"candidato" jsonb NOT NULL,
	"nome" text DEFAULT '' NOT NULL,
	"nome_normalizado" text DEFAULT '' NOT NULL,
	"grupo" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"flag_nomes_divergentes" boolean DEFAULT false NOT NULL,
	"flag_sem_fiscal_tnp" boolean DEFAULT false NOT NULL,
	"flag_sem_barras" boolean DEFAULT false NOT NULL,
	"flag_barras_conflitante" boolean DEFAULT false NOT NULL,
	"flag_sem_grupo" boolean DEFAULT false NOT NULL,
	"flag_ja_no_pralis" boolean DEFAULT false NOT NULL,
	"decisao" text,
	"decidido_por" text,
	"decidido_em" timestamp with time zone,
	"calculado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unif_grupo_item" (
	"id" text PRIMARY KEY NOT NULL,
	"grupo_id" text NOT NULL,
	"fonte_produto_id" text NOT NULL,
	"fonte" text NOT NULL,
	"loja" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_unif_grupo_chave" ON "unif_grupo" USING btree ("chave");--> statement-breakpoint
CREATE INDEX "idx_unif_grupo_motivo" ON "unif_grupo" USING btree ("motivo");--> statement-breakpoint
CREATE INDEX "idx_unif_grupo_nome_norm" ON "unif_grupo" USING btree ("nome_normalizado");--> statement-breakpoint
CREATE INDEX "idx_unif_grupo_decisao" ON "unif_grupo" USING btree ("decisao");--> statement-breakpoint
CREATE INDEX "idx_unif_grupo_revisar" ON "unif_grupo" USING btree ("flag_nomes_divergentes","flag_sem_fiscal_tnp","flag_sem_grupo");--> statement-breakpoint
CREATE INDEX "idx_unif_grupo_item_grupo" ON "unif_grupo_item" USING btree ("grupo_id");--> statement-breakpoint
CREATE INDEX "idx_unif_grupo_item_loja" ON "unif_grupo_item" USING btree ("loja");