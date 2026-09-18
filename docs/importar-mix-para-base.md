# Importar da planilha MIX para a Base

> 18/09/2026. Continuação do [código de cadastro](codigo-interno-planilha-mix.md).

## 1. O defeito que a integração pegou

O PR #63 já estava na `main` quando os testes de integração rodaram pela
primeira vez. O primeiro que eles derrubaram:

```ts
const TRAVA_CUNHAGEM = sql`pg_advisory_xact_lock(hashtext('pralis:codigo_cadastro'))`;
```

Falta o `SELECT`. Postgres devolve `42601 syntax error`, e **todo clique em
"Cunhar código novo" daria erro 500**. Os 55 testes unitários passavam porque o
repositório falso não executa SQL nenhum.

Corrigido aqui. É o argumento mais curto a favor de rodar a integração: o
defeito estava em produção e nenhuma suíte sem banco o veria.

## 2. O que a importação faz

Cria na Base os produtos que existem na aba `MIX PRODUTOS LOJA E PRODUÇÃO
ASSOCIAÇÃO` e ainda não no sistema, **já com o código do PDV**.

A regra que molda tudo: **nunca inventar valor**.

| Campo do cadastro | De onde vem | Quando falta |
|---|---|---|
| nome | `DESCRIÇÃO` | **linha não entra** |
| código interno | `COD INTERNO` | **linha não entra** (fora da faixa do PDV também) |
| código de barras | `COD BARRA 1` | entra vazio |
| unidade de venda | `UNID/KG` → UN/KG/LT | **linha não entra** |
| tipo | `IPPT` → T = revenda, P = transformação | **linha não entra** |
| status | `ATIVO` → só `SIM` é ativo | entra inativo |
| grupo | `MERCADORIAS` | entra vazio |
| marca | `MARCAS` | entra vazio |
| embalagem | `EMB` → UN/CX/KG/FD/PCT/LT | entra vazio (`CONJ` não existe no cadastro) |
| qtd. da embalagem | `QUANT`, só inteiro ≥ 1 | entra vazio |
| setor de estoque | `SETOR` | entra vazio |
| estoque mín/máx | `MIN` / `MAX` (a **primeira** ocorrência) | entra vazio |

**Três recusas são deliberadas e valem explicar:**

- **unidade desconhecida** não vira `UN`. Produto vendido por peso virando
  produto vendido por unidade é preço errado na balança.
- **sem `IPPT`** não vira `revenda`. O tipo decide a regra fiscal.
- **`custo` não é importado.** A aba tem `V. CUSTO` dentro do bloco da TNP e
  `V. CUSTO LI` no da LI; o cadastro da Base vale para a rede. Escolher um dos
  dois seria escolher pelo José — e custo errado não fica só errado: ele
  calcula o preço de venda. Falta decidir qual coluna é o custo da rede.

**O fiscal não vem da MIX.** Quem preenche `product_fiscal` é o
`BackfillFiscalService`, pela fonte já aprovada (ECF/SIA). Trazer alíquota da
planilha criaria uma segunda fonte de verdade no campo de maior consequência do
cadastro. Depois de importar, rode a carga fiscal.

## 3. O que impede duplicar

- compara contra **todo o cadastro vivo**, não só a Base: produto que hoje só
  existe como órfão de loja já ocupa aquele código e aquele código de barras;
- recusa por **código interno** já usado e por **código de barras** já usado;
- recusa código que aparece em **duas linhas da planilha** (o caso do `12422`);
- importar de novo **continua de onde parou** — provado por teste contra banco
  real: rodar duas vezes cria uma vez só.

## 4. Leitura da planilha

Colunas achadas pelo **título**, primeira ocorrência (a aba repete `MIN`, `MAX`
e `MARCAS` nos blocos de loja, mais à direita). A leitura pede **uma faixa
estreita por coluna** em vez do retângulo inteiro: 13 faixas contra ~160 colunas
× 6.000 linhas.

A leitura avisa quando **encheu a janela** (`truncada`): teto defasado faria a
cunhagem colidir com código que já existe na cauda não lida.

## 5. Validação

| Portão | Resultado |
|---|---|
| `npm test` | 586 (API) + 91 (shared) |
| `npm run test:integration` | **247**, 20 arquivos — com Docker |
| `npm run typecheck` | limpo |
| build do PWA | completo |

Cobertura nova contra banco real: transação e guarda otimista do `trocar`,
propagação BASE→loja com histórico por cópia, duas cunhagens concorrentes não
gerando o mesmo número, e a importação criando produto com o código da planilha
e enfileirando o espelho.

## 6. Ordem de uso

1. **Reconciliar o código** (`/produtos/codigo-cadastro`) — alinhar o que já
   existe. Importar antes criaria cadastro novo para produto que já está aqui
   com outro número.
2. **Importar** (`/produtos/importar-mix`), em lotes de 100.
3. **Carga fiscal**, para os produtos novos ganharem fiscal pela fonte aprovada.

## 7. Pergunta aberta

Qual coluna é o custo da rede: `V. CUSTO` (bloco TNP) ou `V. CUSTO LI`? Enquanto
não houver resposta, o custo entra vazio.
