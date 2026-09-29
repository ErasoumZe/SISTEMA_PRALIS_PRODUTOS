CREATE TABLE "creare_export_delivery_state" (
	"loja" text NOT NULL,
	"product_id" text NOT NULL,
	"hash" text NOT NULL,
	"batch_id" text NOT NULL,
	"entregue_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creare_export_delivery_state_loja_product_id_pk" PRIMARY KEY("loja","product_id")
);
--> statement-breakpoint
DROP INDEX "uq_creare_export_batch_aberto";--> statement-breakpoint
ALTER TABLE "creare_export_batch" ADD COLUMN "entregue_em" timestamp with time zone;--> statement-breakpoint
-- Lotes ja confirmados/cancelados nao devem voltar a bloquear a fila.
UPDATE "creare_export_batch" SET "entregue_em" = COALESCE("confirmado_em", "cancelado_em")
WHERE "confirmado_em" IS NOT NULL OR "cancelado_em" IS NOT NULL;--> statement-breakpoint
-- O que ja foi confirmado no SIA tambem foi necessariamente entregue.
INSERT INTO "creare_export_delivery_state" ("loja", "product_id", "hash", "batch_id", "entregue_em")
SELECT "loja", "product_id", "hash", "batch_id", "confirmado_em"
FROM "creare_export_state";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_creare_export_batch_aberto" ON "creare_export_batch" USING btree ("loja") WHERE "creare_export_batch"."entregue_em" IS NULL AND "creare_export_batch"."confirmado_em" IS NULL AND "creare_export_batch"."cancelado_em" IS NULL;
