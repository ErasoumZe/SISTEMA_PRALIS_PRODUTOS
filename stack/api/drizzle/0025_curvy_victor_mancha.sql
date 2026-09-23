CREATE TABLE "user_tela_permissao" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tela_id" text NOT NULL,
	"permitido" boolean NOT NULL,
	"alterado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"alterado_por_user_id" text,
	"alterado_por_nome" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_tela_permissao" ON "user_tela_permissao" USING btree ("user_id","tela_id");--> statement-breakpoint
CREATE INDEX "idx_user_tela_permissao_user" ON "user_tela_permissao" USING btree ("user_id");