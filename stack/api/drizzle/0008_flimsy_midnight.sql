DROP INDEX "uq_produto_creare_natural";--> statement-breakpoint
ALTER TABLE "produto_creare" ADD COLUMN "produto" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_produto_creare_natural" ON "produto_creare" USING btree ("loja","produto_codigo","produto");