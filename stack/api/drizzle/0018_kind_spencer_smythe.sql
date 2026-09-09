-- A quantidade da embalagem e exata ou aproximada?
--
-- Uma caixa de queijo nao tem 20 kg exatos. Sem isso a frase de "como se
-- compra" afirma um peso certo que nao existe, e a conferencia de entrada
-- acusa diferenca que nao ha. `false` = exato, que e o caso comum.
--
-- Aditiva e com default: nao trava tabela grande nem quebra linha existente.
ALTER TABLE "products" ADD COLUMN "compra_aproximada" boolean DEFAULT false NOT NULL;
