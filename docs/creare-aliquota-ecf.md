# Por que a alíquota de saída do ECF NÃO é derivada

**Decisão:** o campo `ecfTaxCode` (posições 54-55 do layout) é copiado do SIA,
via de-para por código de barras. Não é calculado a partir da situação fiscal
do produto no Pralis.

O plano da Fase 1 pedia o contrário — trocar `ecfTaxCodesByGroup` por uma
derivação a partir de CST/CSOSN. A intenção estava certa (o grupo comercial
realmente não determina a alíquota), mas a derivação não é possível. Segue a
medição, feita sobre a exportação real do SIA da Lisboa de 01/09/2026, 4.186
produtos.

## O que a regra proposta erraria

Regra testada: ST → `10`, tributado (base 18%) → `03`, isento → `11`,
uso/consumo → `01`.

```
total: 4186 | acertos: 2984 | ERROS: 1202  (28,71%)

  SIA=10 mas derivaria 11: 939
  SIA=3  mas derivaria 10: 144
  SIA=1  mas derivaria 11: 113
  SIA=3  mas derivaria 11:   5
  SIA=10 mas derivaria  3:   1
```

Aplicar isso reescreveria a tributação de 1.202 produtos no PDV.

## Por que nenhuma outra regra resolve

Não é questão de afinar a regra. Agrupando por **toda** a informação fiscal
disponível — CSOSN + CST de entrada + CST de saída + alíquota interna + %
redução + uso/consumo + NCM — o resultado ainda é ambíguo:

```
combinacoes fiscais distintas: 643
AMBIGUAS (mesma situacao fiscal -> codigos ECF diferentes): 12
linhas afetadas: 98

  csosn=500 cstEnt=060 cstSaida=000 interna=0 red=0 uso=N ncm=19021900
     -> ECF 10 (15x) , ECF 3 (2x)
  csosn=101 cstEnt=000 cstSaida=000 interna=0 red=0 uso=N ncm=19059090
     -> ECF 10 (12x) , ECF 1 (2x) , ECF 3 (1x)
```

Produtos fiscalmente idênticos têm códigos de ECF diferentes. Ou seja: o código
de ECF **não é uma função** da situação fiscal. A informação que o separa não
está no cadastro — está numa decisão histórica de quem cadastrou.

## Consequência prática

Copiar o valor do SIA é a opção segura: o arquivo reafirma o que o PDV já tem,
e a Fase 1 não altera tributação de ninguém. Corrigir tributação errada é um
trabalho legítimo, mas é outro trabalho — feito produto a produto, com quem
responde pelo fiscal, e não como efeito colateral de uma exportação.

O `GET /admin/creare/health` mostra a distribuição dos códigos que seriam
exportados, para conferência antes de qualquer importação real.

## Como reproduzir

A medição saiu de `exportacaoSIA.xls` (exportação do SIA Supervisor, 340
colunas). Colunas usadas: `Cód. produto` (3), `Cód. barras` (4), `Alíq. Saída`
(23), `% Redução` (29), `CSOSN_EMPRESA` (20), `CST Entrada` (19), `CST Saída`
(40), `NCM` (41), `Alíq. interna` (16), `Uso consumo` (45), `Cód. grupo` (78).
