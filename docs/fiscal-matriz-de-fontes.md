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

## Escopo por loja

O cadastro de ECF disponível é **da TNP**. Não há prova de que os mesmos códigos
valham para a LI, e copiar de uma loja para a outra é exatamente o que a regra
do projeto proíbe. Enquanto não houver o cadastro da LI, o que a LI recebe vem
da regra do grupo e do de-para — a carga de ECF fica pendente.

## Estados

| Estado | Significa | Quem resolve |
|---|---|---|
| `completo` | tudo que a fonte tem foi copiado | ninguém |
| `parcial` | grupo aplicado, sem registro de ECF para o produto | quem cadastra no Creare |
| `nao_classificado` | criado pela Central; nunca passou pela classificação | o backfill |
| `pendente_grupo_invalido` | grupo fora das 76 regras oficiais | admin, na BASE |
| `pendente_ambiguo` | mais de um registro de ECF com o mesmo nome | decisão humana |
| `pendente_conflito` | grupo e ECF discordam do CST | contador |
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

## As duas colunas `REDUCAO_ICMS`

A faixa fiscal tem `REDUCAO_ICMS` em `DC` e em `DP`. Não são dois dados — são o
mesmo número em duas notações, como no cadastro de origem:

```
AC = 5333   6111      formato do Creare, 2 casas implícitas
AZ = 53,33  61,11     o mesmo valor, como percentual
```

Das 709 linhas com `AZ` preenchido, `AC` e `AZ` coincidem como texto em **1**.

**Pendente de decisão:** qual notação cada coluna espera na planilha nova. As
duas estão vazias, então não há precedente, e o TXT do Creare é gerado do banco.
Hoje escrevemos só `DC`, na grafia percentual que já era usada.

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
```

Pela aplicação: `GET /admin/fiscal/panorama` e `POST /admin/fiscal/backfill`
(`aplicar` é `false` por padrão), ou a página **Manutenção**.

## O que depende de decisão sua

1. **`DC` e `DP`**: qual recebe `5333` e qual recebe `53,33`?
2. **Grupos legados**: `SORVETES` é `MER SORVETES - POTES` ou `- PICOLÉS`?
   Mesma pergunta para `BOMBONIERI`, `BISCOITO`, `GERAL`, `SUCO, ISOT E AGUA` e
   `MAT. PRIMA (FARINHA)`.
3. **ECF da LI**: o cadastro de ECF disponível é da TNP. Os mesmos códigos valem
   para a Lisboa, ou existe um cadastro próprio a trazer?
