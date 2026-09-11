# Fiscal: de onde vem cada campo

> Medido na planilha de produção em 11/09/2026, não herdado de relatório.
> Números conferidos por `stack/api/scripts/auditar-fiscal-pos-pr38.ts`.

## As três fontes

| Fonte | Onde | Chave | O que entrega |
|---|---|---|---|
| **Regra do grupo** | aba fiscal, `AB4:AG79` — 76 grupos | nome do grupo | CST PIS/COFINS, tributação (Simples), alíquota do Simples, % ICMS RE, base fiscal |
| **De-para por produto** | aba fiscal, `A4:E2000` — 944 produtos | código de barras / PLU | NCM, CST, % ICMS RE |
| **Cadastro de ECF** | aba `(TNP) FISCAL - CADASTRO ECF` — 3.122 produtos | **nome** | redução, alíquota cheia, FCP, PIS, COFINS, **alíquota ECF**, **ECF ID**, categoria, ICMS, CEST, % NCM |

O cadastro de ECF **não tem código de barras**: a coluna `REFERENCIA` do Creare
é `0000000000000000` nas 3.122 linhas. Por isso a chave dele é o nome — e é por
isso que o nome tem de viajar junto na classificação.

## Campo a campo

| Campo | Fonte | Em conflito | Ausente |
|---|---|---|---|
| `ncm` | de-para por barras → ECF | de-para vence (é por produto) | fica nulo |
| `cstPisCofins` | regra do grupo | **pendência**, ninguém vence | fica nulo |
| `aliquotaCheia`, `reducaoIcms`, `aliquotaFcp`, `aliquotaPis`, `aliquotaCofins` | ECF | — | nulo, nunca zero |
| `aliquotaEcf`, `aliquotaEcfId` | **só** ECF | — | nulo — **nunca derivado** |
| `categoria`, `cest`, `pctNcm`, `icms` | ECF | — | nulo |
| `tributacaoSimples`, `aliquotaSimples`, `icmsRe`, `baseFiscal` | regra do grupo | — | nulo |
| `cstReforma`, `cClassTrib`, `aliquotaIbs`, `aliquotaCbs` | tabela da reforma, por NCM | — | nulo |

O CST do cadastro de ECF é `99` ("outras operações") na maioria das linhas —
marcação genérica do cadastro antigo. **`99` não conta como divergência**; só
vira conflito quando a fonte afirma um CST de verdade que discorda do grupo.
Medido hoje: **1 produto** (`BEBIDA LACTEA PIRAKIDS 200ML`, grupo diz 4, ECF diz 99
— e portanto nem entra como conflito pela regra acima).

## Escopo por loja — a fonte é DECLARADA

O cadastro de ECF disponível é **da TNP**. Não há prova de que os mesmos códigos
valham para a LI, e copiar de uma loja para a outra é exatamente o que a regra
do projeto proíbe. Isso deixou de ser observação e virou código: a fonte de cada
loja está declarada em `FONTES_ECF`, no `tax-rule.service.ts`.

```ts
export const FONTES_ECF = {
  BASE: '(TNP) FISCAL - CADASTRO ECF',
  TNP:  '(TNP) FISCAL - CADASTRO ECF',
};
```

Loja fora do mapa **não recebe carga de ECF**: recebe a regra do grupo e o
de-para por código de barras, e fica em `pendente_fonte_da_loja`. Hoje isso vale
para **LI** e **HORA**. No dia em que a Lisboa exportar o Creare dela, é uma
linha a mais aqui — nada mais muda.

`BASE` usa a da TNP porque a faixa fiscal da planilha é **uma só por produto** e
o que já havia nela veio da TNP: é o estado de hoje reproduzido, não uma escolha
nova. Se isso tiver de mudar, muda aqui e em lugar nenhum mais.

## Grupos legados: o de-para existe, vazio

Os 12 produtos em 6 grupos fora das 76 regras têm agora um caminho formal:
`src/modules/apoio/grupos-legados.ts`. Cada linha é uma decisão registrada, com
o grupo oficial, a data e quem decidiu — versionada, para aparecer no diff e no
PR.

Começa **vazio de propósito**. `SORVETES` pode ser `MER SORVETES - POTES` ou
`MER SORVETES - PICOLÉS`, que têm tributação diferente; escolher por semelhança
de texto seria atribuir imposto por parecença de palavra.

```bash
# a folha de decisão: produto a produto, com os candidatos oficiais ao lado
cd stack/api && npx tsx scripts/grupos-legados.ts
```

Preenchido o arquivo, a tradução passa a valer na classificação; quem aplica aos
produtos já gravados é o backfill, com `--apply`.

## Estados

| Estado | Significa | Quem resolve |
|---|---|---|
| `completo` | tudo que a fonte tem foi copiado | ninguém |
| `parcial` | grupo aplicado, sem registro de ECF para o produto | quem cadastra no Creare |
| `nao_classificado` | criado pela Central; nunca passou pela classificação | o backfill |
| `pendente_grupo_invalido` | grupo fora das 76 regras oficiais | admin, na BASE |
| `pendente_ambiguo` | mais de um registro de ECF com o mesmo nome | decisão humana |
| `pendente_conflito` | grupo e ECF discordam do CST | contador |
| `pendente_fonte_da_loja` | a loja não tem cadastro de ECF exportado | quem traz o export da loja |
| `fonte_indisponivel` | não deu para ler agora | ninguém: volta sozinho |

`parcial` e `nao_classificado` voltam à fila do backfill; as pendências `pendente_*`
não, porque insistir não muda o resultado.

## Cobertura medida

```
produtos na aba de cadastro    1.202
casam no ECF por nome único      576
nome ambíguo no ECF                1
sem correspondência              625
grupos fora das regras oficiais   12 produtos, 6 grupos
```

Os 625 sem correspondência **não são defeito**: são produtos que nunca foram
cadastrados no Creare. Alíquota de ECF só pode ser copiada de lá.

Grupos gravados que não existem entre as 76 regras: `SUCO, ISOT E AGUA` (6),
`BOMBONIERI` (2), `BISCOITO`, `GERAL`, `SORVETES`, `MAT. PRIMA (FARINHA)`.
A tabela oficial tem equivalentes mais específicos (`MER BOMBONIERI - CHOCOLATES`,
`MER SORVETES - POTES`, `MER SORVETES - PICOLÉS`, `MER MAT. PRIMA - FARINHAS`),
mas a equivalência **não é automática**: `SORVETES` pode ser POTES ou PICOLÉS, e
escolher por semelhança de texto seria inventar classificação.

## As duas colunas `REDUCAO_ICMS` — resolvido pelo FORMATO

A faixa fiscal tem `REDUCAO_ICMS` em `DC` e em `DP`. Não são dois dados — são o
mesmo número em duas notações, como no cadastro de origem:

```
AC = 5333   6111      formato do Creare, 2 casas implícitas
AZ = 53,33  61,11     o mesmo valor, como percentual
```

Das 709 linhas com `AZ` preenchido, `AC` e `AZ` coincidem como texto em **1**.

As duas colunas da planilha nova estão **vazias**, então não havia precedente de
conteúdo — mas há precedente de **formato**. `scripts/formato-colunas-fiscais.ts`
lê o `numberFormat` das células (não o valor) e mostra:

```
ANTIGA · AC (REDUCAO_ICMS)  →  NUMBER   pattern 0000     inteiro preenchido com zero
ANTIGA · AZ (REDUCAO_ICMS)  →  PERCENT  pattern 0.00%    fração
NOVA   · DC, DP, DD         →  NUMBER   pattern #0       INTEIRO, sem casas decimais
```

`#0` é inteiro: gravar `53.33` ali **exibe `53`** e perde os 0,33 sem avisar
ninguém. Por isso os cinco campos numéricos do Creare vão na grafia de origem,
por `formatoCreare()`:

| Campo | Coluna | Casas | Largura | `53,33%` vira |
|---|---|---|---|---|
| `reducaoIcms` | BS | 2 | 4 | `5333` |
| `aliquotaCheia` | BT | 3 | 5 | `53330` |
| `aliquotaFcp` | BU | 2 | 4 | `5333` |
| `aliquotaPis` | BW | 4 | 8 | `00533300` |
| `aliquotaCofins` | BX | 4 | 8 | `00533300` |

Isso reproduz o cadastro de origem, não converte nada. A escala de PIS e COFINS
é a única não verificável: as 3.122 linhas da fonte são zero, e zero é zero em
qualquer escala — se um valor diferente de zero aparecer, confira antes de
confiar. Ida e volta fecham: `formato-creare.test.ts` prova
`formatoCreare(parseCampoCreare(x)) === x`.

## Comandos

```bash
# panorama + conferência (nada é gravado)
cd stack/api && npx tsx scripts/backfill-fiscal.ts

# um produto só — é o canário
npx tsx scripts/backfill-fiscal.ts --produto <uuid>

# aplicar, em lotes, retomando pelo cursor que ele imprime
npx tsx scripts/backfill-fiscal.ts --apply --limite 50
npx tsx scripts/backfill-fiscal.ts --apply --limite 50 --cursor <uuid>

# auditoria da planilha, só leitura
npx tsx scripts/auditar-fiscal-pos-pr38.ts

# formato (não valor) das colunas fiscais — foi isto que decidiu a notação
npx tsx scripts/formato-colunas-fiscais.ts

# folha de decisão dos grupos legados
npx tsx scripts/grupos-legados.ts
```

Pela aplicação: `GET /admin/fiscal/panorama` e `POST /admin/fiscal/backfill`
(`aplicar` é `false` por padrão), ou a página **Manutenção**.

## O que depende de decisão sua

1. ~~**`DC` e `DP`**: qual notação?~~ **Resolvido pelo dado**: as colunas são
   `NUMBER #0` (inteiro), e a grafia do Creare é a única que não perde casa.
2. **Grupos legados**: `SORVETES` é `MER SORVETES - POTES` ou `- PICOLÉS`?
   Mesma pergunta para `BOMBONIERI`, `BISCOITO`, `GERAL`, `SUCO, ISOT E AGUA` e
   `MAT. PRIMA (FARINHA)`. O mecanismo está pronto e vazio; a folha de decisão
   sai de `scripts/grupos-legados.ts`. **Só isto continua esperando você.**
3. ~~**ECF da LI**~~ **Fechado pela regra, não por suposição**: a LI não recebe
   ECF da TNP. Fica em `pendente_fonte_da_loja` até existir export da Lisboa —
   e aí é uma linha em `FONTES_ECF`.
