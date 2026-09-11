-- `% NCM` por produto.
--
-- A coluna existe na planilha (`DM` da faixa fiscal) e na fonte de ECF, e não
-- tinha caminho nenhum entre as duas: o valor era lido da fonte e descartado.
--
-- Só 908 das 3.122 linhas da fonte têm valor — ausência aqui é ausência, não
-- zero, e por isso a coluna é anulável.
--
-- Aditivo e idempotente: `start:prod` roda `drizzle-kit push --force` no boot.
ALTER TABLE "product_fiscal" ADD COLUMN IF NOT EXISTS "pct_ncm" numeric(6, 4);
