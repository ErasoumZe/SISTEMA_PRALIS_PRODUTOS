CREATE TABLE "creare_export_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"loja" text NOT NULL,
	"conteudo" text NOT NULL,
	"sha256" text NOT NULL,
	"itens" jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmado_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "creare_export_state" (
	"loja" text NOT NULL,
	"product_id" text NOT NULL,
	"hash" text NOT NULL,
	"batch_id" text NOT NULL,
	"confirmado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creare_export_state_loja_product_id_pk" PRIMARY KEY("loja","product_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_creare_export_batch_aberto" ON "creare_export_batch" USING btree ("loja") WHERE "creare_export_batch"."confirmado_em" IS NULL;