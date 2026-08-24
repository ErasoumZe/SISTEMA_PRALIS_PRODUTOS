ALTER TABLE "product_fiscal" ADD COLUMN "tributacao_simples" text;--> statement-breakpoint
ALTER TABLE "product_fiscal" ADD COLUMN "aliquota_simples" numeric(8, 6);--> statement-breakpoint
ALTER TABLE "product_fiscal" ADD COLUMN "icms_re" numeric(8, 6);--> statement-breakpoint
ALTER TABLE "product_fiscal" ADD COLUMN "base_fiscal" text;