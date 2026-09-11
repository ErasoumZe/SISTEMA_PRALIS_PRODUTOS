-- Estado fiscal por produto: em que pé está, e por quê.
--
-- Sem isto, "cadastro salvo" e "fiscal resolvido" eram indistinguíveis. Um
-- produto com grupo fora das 76 regras oficiais, ou sem registro no cadastro de
-- ECF, aparecia como concluído — e só a planilha vermelha denunciava.
--
-- `estado` é um dos valores de `EstadoFiscal`; `motivo` é a frase que a tela
-- mostra; `conferido_em` separa "nunca tentei" de "tentei e não havia fonte".
--
-- Aditivo e idempotente: `start:prod` roda `drizzle-kit push --force` no boot e
-- as colunas podem já ter sido criadas por ele.
ALTER TABLE "product_fiscal" ADD COLUMN IF NOT EXISTS "estado" text;--> statement-breakpoint
ALTER TABLE "product_fiscal" ADD COLUMN IF NOT EXISTS "motivo" text;--> statement-breakpoint
ALTER TABLE "product_fiscal" ADD COLUMN IF NOT EXISTS "conferido_em" timestamp with time zone;--> statement-breakpoint
-- Quem consulta pendência sempre filtra por estado; sem índice isso é varredura
-- na tabela inteira a cada abertura da tela.
CREATE INDEX IF NOT EXISTS "product_fiscal_estado_idx" ON "product_fiscal" ("estado");
