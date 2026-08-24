ALTER TABLE "product_fiscal" ADD COLUMN "codigo_fiscal" text;--> statement-breakpoint
ALTER TABLE "product_fiscal" ADD COLUMN "produto_fiscal" text;--> statement-breakpoint
ALTER TABLE "product_fiscal" ADD COLUMN "cst_reforma" text;--> statement-breakpoint
ALTER TABLE "product_fiscal" ADD COLUMN "cclass_trib" text;--> statement-breakpoint
ALTER TABLE "product_fiscal" ADD COLUMN "aliquota_ibs" numeric(8, 6);--> statement-breakpoint
ALTER TABLE "product_fiscal" ADD COLUMN "aliquota_cbs" numeric(8, 6);--> statement-breakpoint
ALTER TABLE "product_fiscal" ADD COLUMN "origem_fiscal" text;