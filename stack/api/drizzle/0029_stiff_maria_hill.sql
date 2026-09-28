DROP INDEX "uq_creare_export_batch_aberto";--> statement-breakpoint
ALTER TABLE "creare_export_batch" ADD COLUMN "formato_versao" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "creare_export_batch" ADD COLUMN "cancelado_em" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_creare_export_batch_aberto" ON "creare_export_batch" USING btree ("loja") WHERE "creare_export_batch"."confirmado_em" IS NULL AND "creare_export_batch"."cancelado_em" IS NULL;