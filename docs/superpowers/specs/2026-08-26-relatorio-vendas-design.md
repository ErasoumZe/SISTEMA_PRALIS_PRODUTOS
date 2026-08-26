# Módulo de relatório de vendas — desenho

Data: 26/08/2026
Status: aprovado para virar plano de implementação
Branch de trabalho: `homologacao/cadastro-produtos-2026-08-25` (nunca `main` —
deploy automático no Coolify)

## 1. Objetivo

Trazer a venda que acontece no PDV para dentro do Pralis e responder, por loja e
por período:

- faturamento por dia e no período;
- quantidade vendida por produto;
- ranking dos mais e dos menos vendidos;
- curva ABC por faturamento;
- margem e lucro bruto, cruzando a venda com o custo do cadastro;
- formas de pagamento por dia (as 12 do PDV, mais `OUTROS`).

**Ticket médio por dia sai de graça** e não estava previsto: o fechamento traz
`NUMERO_VENDAS` (`COUNT(DISTINCT ID_VENDA_BALCAO)`), então
`total_pagamento / numero_vendas` dá o ticket por dia, PDV e operador.

**Fora de escopo nesta etapa** (o dado não existe hoje; exigem query nova no
robô): **cesta de compras** (o que sai junto no mesmo cupom) e **venda por
hora**. O timestamp existe em `VENDAS_TIPOS`, mas as vendas diárias são
agregadas por dia, e não há detalhe por cupom.

## 2. Fonte do dado

O robô (`C:\Users\José\Desktop\bot`, **fora deste repositório**) lê o
MySQL do Creare/Compilart e hoje escreve em abas do Google Sheets.

Nesta etapa ele passa a **também** enviar para a API do Pralis por `POST`. O
Postgres vira a fonte do relatório. A escrita na planilha **não é desligada** —
ela continua como espelho e conferência.

As abas `RELATORIO CRIARE <loja>`, `RELATORIO COMPILART <loja>` e
`BASE FULL SIA <loja>` **não saem do robô** — são exportações manuais. Nada aqui
depende delas.

### 2.1 Grão real, verificado no SQL

`queries/CREARE_COMPILART_ITENS_VENDAS_DIARIAS.sql`:

```sql
GROUP BY ivb.ID_PRODUTO, cp.CODIGO, ivb.DESCRICAO_PRODUTO,
         DATE(ivb.DTHR_ITEM_VENDABALCAO)
```

Grão: **produto × dia × loja**. Volume atual ~90.827 linhas,
02/01/2026 → 20/08/2026.

`queries/CREARE_COMPILART_FECHAMENTO_CAIXA.sql`:

```sql
GROUP BY x.DATA_VENDA, x.ID_DISPOSITIVO, x.CAIXA, x.ID_USUARIO, x.USUARIO
```

Grão: **dia × PDV × operador**. Não existe `TURNO` no agrupamento.

### 2.2 Formato dos valores

`services/recordService.js` normaliza antes de gravar: número com **vírgula**
decimal e data `dd/mm/aaaa`. A API precisa converter na entrada.

### 2.3 Empresas

O robô manda `TNP CENTRAL`, `LISBOA CENTRAL`, `HORA`. O Pralis usa `TNP`, `LI`,
`HORA`. De-para fixo na ingestão; empresa desconhecida **recusa o lote**.

## 3. Modelo de dados

### 3.1 `venda_produto_dia`

```
loja | data | produto_codigo | produto | quantidade | valor_unitario |
total | hash | atualizado_em
```

**`UNIQUE (loja, data, produto_codigo, produto)`**

A descrição entra na chave de propósito. `PRODUTO_CODIGO` vem de um `LEFT JOIN`
e **pode vir vazio**; com uma chave de três campos, todos os produtos sem código
do mesmo dia colapsariam em uma linha só, somando silenciosamente coisas
diferentes. O `GROUP BY` do robô inclui a descrição — a chave acompanha o grão.

Linhas com `produto_codigo` vazio são aceitas e **contadas**: o relatório mostra
quantas são e quanto faturamento representam.

### 3.2 `fechamento_caixa_dia`

```
loja | data | pdv | operador |
primeira_venda | ultima_venda | numero_vendas |
dinheiro | debito | credito | pix | voucher | crediario |
clientes | colaboradores | alimentacao | roubo_furto | socios | sobra_perda |
outros | total_pagamento |
hash | atualizado_em
```

**`UNIQUE (loja, data, pdv, operador)`** — igual à `CHAVE` que o próprio robô
monta (`EMPRESA|DATA|PDV|OPERADOR`).

**Não** usar `(loja, data, caixa, turno)`: dois operadores no mesmo PDV no mesmo
dia seriam fundidos e um deles sumiria.

`crediario` continua no schema e sai zerado — a forma virou `CLIENTES` no ERP,
mas há ~2.500 linhas históricas. `outros` é a rede de segurança: forma que não
casa com nenhuma das 12 cai ali, e o relatório destaca quando não é zero.

#### Derivadas: `natureza`, `caixa`, `turno`

Guardadas no grão bruto e derivadas do `operador`, replicando
`bot/services/operadorService.js`:

| Padrão do `operador` | natureza | caixa | turno |
|---|---|---|---|
| `VND CAIXA PDV - 1M` | `posto` | 1 | `M` |
| `VND CAIXA PDV - 3T` | `posto` | 3 | `T` |
| `TOTEN`, `BURPIZ`, `PEDIDO MESA`, `CAIXA_UNICO` | `canal` | — | — |
| qualquer outro | `nominal` | — | — |

Regex: `/^VND\s+CAIXA\s+PDV\s*-\s*(\d+)\s*([MT])$/i`.

Por que derivar e não agrupar: a aba de fechamento da planilha é organizada por
caixa+turno, e **na Lisboa isso é obrigatório** — a manhã usa login nominal e a
tarde usa posto, e os dois precisam somar na mesma linha. No banco vale o
contrário: guardar no grão bruto e agregar na consulta. As duas coisas estão
certas nos seus lugares; a derivação existe para o relatório reconciliar com a
planilha.

`colaborador` (a pessoa) **não** entra nesta etapa: depende da aba
`DE_PARA_OPERADORES`, que vive no robô.

### 3.3 `produto_creare` (de-para de exceção)

```
loja | produto_codigo | product_id | confirmado_por | confirmado_em
```

**`UNIQUE (loja, produto_codigo)`**. Só recebe vínculo **confirmado por
pessoa** — sugestão automática nunca vira vínculo.

## 4. Ingestão

`POST /vendas/importar` — autenticado, apenas admin, recebe lote com
`{ tipo: 'venda_produto_dia' | 'fechamento_caixa_dia', linhas: [...] }`.

Para cada linha:

1. `hash` já existe na tabela → **ignora** (reenvio idêntico);
2. senão → `UPSERT` pela chave natural, **sobrescrevendo somente se o
   `atualizado_em` recebido for mais novo** que o armazenado.

### Por que o `hash` não pode ser chave primária

O `HASH` do robô é hash de **conteúdo**, não de identidade
(`bot/services/syncService.js`):

```js
addHash(record, [automationName, empresa, DATA_VENDA, PRODUTO_CODIGO,
                 PRODUTO, QUANTIDADE, TOTAL])
```

Quando um dia é reprocessado e a quantidade muda, o hash muda e o robô
**acrescenta outra linha** — ele só pula quando o hash já existe. Se o hash
virasse chave primária, um dia corrigido viraria duas linhas e **o relatório
contaria em dobro**. Daí a regra: chave natural manda, hash só descarta reenvio
idêntico, `atualizado_em` desempata.

### Erros

Lote com qualquer linha inválida (número não parseável, data fora de
`dd/mm/aaaa`, empresa desconhecida) é **recusado inteiro**, com a lista das
linhas ruins. Sem importação parcial silenciosa.

## 5. Ligação com o cadastro (margem)

O `produto_codigo` do Creare é o **código padrão** do produto: o EAN quando
existe, senão um código interno igual ao `ID_PRODUTO`. Verificado na amostra:

| Produto | ID_PRODUTO | código |
|---|---|---|
| LAYS SOUR CREAM | 712.973 | `7892840825188` (EAN) |
| AÇAFRAO KG | 10.001 | `10001` (= o próprio ID) |
| AÇUCAR REI FINO 1KG | 10.010 | `10010` (= o próprio ID) |

### 5.1 Reutilizar `barcodeCandidates`

O join **não** compara `codigoBarras` cru. Reutiliza
`barcodeCandidates()` de `stack/api/src/modules/apoio/tax-rule.service.ts`, que
já é usada e testada na classificação fiscal:

```ts
if (digits.length === 13 && digits.startsWith('2')) out.add(code(digits.slice(1, 6)));
```

Ela extrai o PLU de um EAN de balança (`2` + 5 dígitos) e tira zeros à esquerda
— e o código que o Creare exporta para pesável **é exatamente esse PLU**
(`AÇAFRAO KG` → `10001`). Pão, salgado, confeitaria e granel casam
automaticamente, desde que o produto no Pralis carregue o EAN de balança.

O índice é montado a partir do catálogo Pralis: para cada produto,
`barcodeCandidates(codigoBarras)` gera as chaves; o `produto_codigo` do Creare é
normalizado com a mesma função `code()` e procurado nesse índice.

**Limite honesto:** onde o produto no Pralis não tem `codigoBarras` cadastrado,
não há o que casar — cai no de-para.

### 5.2 De-para para a exceção

Tela lista os `produto_codigo` sem vínculo, ordenados por faturamento
(resolver primeiro o que mais pesa). Para cada um, **propõe candidatos por
semelhança de nome** entre o `PRODUTO` do Creare e o `ProductRules.montarDescricao`
do Pralis. A pessoa confirma com um clique. Sugestão nunca vira vínculo sozinha.

### 5.3 Cobertura sempre visível

Todo indicador de margem/lucro vem acompanhado da cobertura:

> "Margem calculada sobre 68% do faturamento — 412 produtos sem custo cadastrado."

Com link para a tela de de-para. **Margem parcial apresentada como total é pior
que margem nenhuma**: numa padaria, o pão sem custo cadastrado se esconde atrás
da Coca-Cola e a decisão sai errada.

## 6. Relatório

Uma tela, filtro por loja e período:

- **Resumo**: faturamento, quantidade, nº de vendas e **ticket médio**
  (`total_pagamento / numero_vendas`, do fechamento).
- **Ranking**: mais vendidos e menos vendidos, por quantidade e por faturamento.
- **Curva ABC**: classes A/B/C pelo acumulado de faturamento (80/15/5).
- **Margem e lucro**: por produto e total, com a cobertura declarada.
- **Formas de pagamento**: por dia, as 12 colunas + `OUTROS` em destaque quando
  não for zero.

## 7. Ordem de entrega

O desenho é coerente como um todo, mas grande demais para um plano só. Sugestão
de fatiamento — cada fatia entrega valor sozinha:

1. **Ingestão**: as duas tabelas, as derivadas e o `POST /vendas/importar`.
   Sem tela. Fecha quando um lote de exemplo entra, reenvia sem duplicar e um
   dia corrigido substitui o anterior.
2. **Relatório sem margem**: faturamento, quantidade, ranking, curva ABC,
   ticket médio e formas de pagamento. Já é útil sem depender do join.
3. **Margem e cobertura**: join por `barcodeCandidates`, indicador de
   cobertura e a tela de de-para com sugestão por semelhança.

## 8. Decisões registradas

1. Robô → API → Postgres. Descartado ler as abas (amarra ao formato, gasta cota
   do Google, fica lento).
2. Chave natural manda; hash só descarta reenvio idêntico.
3. `(loja, data, produto_codigo, produto)` — a descrição entra na chave porque o
   código pode vir vazio.
4. `(loja, data, pdv, operador)` no fechamento; `caixa`/`turno` são derivadas.
5. Join por `barcodeCandidates`, não por `codigoBarras` cru.
6. Vínculo de de-para exige confirmação humana.
7. A planilha continua sendo espelho do cadastro; não é desligada.

## 9. Riscos

- **O robô ainda não faz `POST`.** Esta etapa entrega o lado do Pralis
  (schema + endpoint + relatório). A alteração no robô é trabalho à parte, no
  repositório dele.
- **`colaborador` fora de escopo** — depende da aba `DE_PARA_OPERADORES`.
- **Canais da HORA** (`TOTEN`, `BURPIZ`) entram como `natureza = canal` e ficam
  sem caixa/turno. O de-para desses canais é decisão pendente do José.
- Produto sem `codigoBarras` no Pralis não casa automaticamente; a cobertura
  mede o tamanho disso já na primeira carga.
