-- Alíquota de ECF por produto, copiada do cadastro fiscal existente.
--
-- TEXTO nos dois: a coluna do Creare mistura "18,00%", "SUBST TRIB" e "ISENTO"
-- na mesma posição, e o ID ("03", "10", "11") tem zero à esquerda que faz parte
-- do código. Guardar como número perderia dois dos três valores e o zero.
--
-- Aditivo e idempotente: `IF NOT EXISTS` porque `start:prod` roda
-- `drizzle-kit push --force` no boot e a coluna pode já ter sido criada por ele.
-- O separador NÃO é decoração: o migrator do drizzle quebra o arquivo por ele.
-- Sem o separador, os dois ALTER viram uma única instrução e a migration falha.
ALTER TABLE "product_fiscal" ADD COLUMN IF NOT EXISTS "aliquota_ecf" text;--> statement-breakpoint
ALTER TABLE "product_fiscal" ADD COLUMN IF NOT EXISTS "aliquota_ecf_id" text;
