# Código de cadastro: o Pralis passa a usar o código do PDV

> 18/09/2026. Distingue o que foi **medido**, o que é **regra aprovada** e o que
> continua **pergunta**.

## 1. A descoberta que mudou o desenho

A primeira versão deste documento afirmava que o `codigo_interno` **não**
alimentava o PDV. **Estava errado**, e o erro veio de procurar só em
`stack/api/src/modules/creare/` — o gerador do TXT mora em `stack/shared/`.

O que [`creare.generator.ts:183-188`](../stack/shared/src/creare/creare.generator.ts)
faz de verdade:

- quando o produto tem par no SIA e o `codigo_interno` do Pralis é **outro**,
  lança `CreareValidationError` → `creare.service.ts` põe o produto em
  `invalidos` → **o produto sai do TXT**, em silêncio;
- quando não há par no SIA, escreve o `codigo_interno` direto como código do PDV.

E as duas numerações são a mesma. Medido cruzando a aba `MIX PRODUTOS LOJA E
PRODUÇÃO ASSOCIAÇÃO` com o de-para do SIA:

| Confronto | Linhas |
|---|---|
| mesmo código **e** mesmo nome | **2.962** |
| mesmo código, nome variando (`COXINHA DE COSTELA` × `COXINHA COSTELA`) | 16 |
| código só na planilha | 464 |

`10000` é `ABACAXI UNID` nos dois. O `COD INTERNO` da planilha **é** o `coditem`
do PDV.

## 2. Comportamento atual (comprovado)

| Fato | Como foi comprovado |
|---|---|
| 944 produtos, todos com código na faixa **1–1335** | exportação `produtos-20260918.csv` |
| de-para do SIA: **4.186** linhas, **4.178** com código de barras (99,8%) | `fonte_sia_lisboa.csv` |
| **753** produtos casam com o SIA por código de barras, **zero ambíguos** | cruzamento medido |
| **nenhum** dos 753 está com o `coditem` hoje | idem — ou seja, todos seriam recusados no TXT |
| a planilha MIX tem código de barras em só 783 de 3.443 linhas (23%) | cópia de 02/09 |
| o backfill roda no boot, antes do servidor | `Dockerfile:40` → `start:prod` |

**Por isso a régua é o de-para do SIA, não a planilha**: mesma numeração,
cobertura de código de barras quase completa, e unicidade já garantida no banco
(`uq_sia_depara_barras`). A planilha entra só como **teto** da numeração.

## 3. Regras e fontes

- O código do produto passa a ser o do PDV. **Fonte:** decisão do José, 18/09.
- Código de barras decide; nome nunca decide sozinho. **Fonte:** José, 18/09.
- Um código por produto, igual entre lojas. **Fonte:** DB-04 (`backlog.md`).
- Cunhar só por último, item a item, com confirmação. **Fonte:** José, 18/09.

## 4. Escopo

**Dentro:** motor de classificação em cinco baldes; prévia; adoção em lote só do
balde exato; decisão item a item; cunhagem sequencial sob trava; histórico
reversível por produto **e por cópia de loja**; espelho enfileirado para a
coluna AC.

**Fora (e por quê):** a **importação em massa** dos produtos que existem na
planilha e não no sistema (~2.700). Ela depende do mapeamento das 248 colunas da
aba e cria milhares de cadastros — merece PR e rodada de teste próprios. Também
fora: escrever na planilha MIX (só leitura) e mexer no `coditem` do SIA.

## 5. Como cada produto é classificado

| Balde | O que é | Quem decide |
|---|---|---|
| `exato` | código de barras casa com o SIA, sem disputa | botão, em lote de até 200 |
| `conflito-sia` | lojas discordam do código, ou o número é curto demais para ser código de barras | você, item a item |
| `disputado` | dois cadastros do Pralis querem o mesmo código | você, unificando antes |
| `novo` | nenhum produto do SIA tem esse código de barras | você, cunhando |
| `ja-correto` | já está com o código do PDV | ninguém |

**Só a BASE e os órfãos entram.** Cópia de loja fica de fora: ela herda da BASE
e o `backfill-codigo-interno.ts` a reescreve a cada boot — listar a cópia faria
a mesma mercadoria aparecer três vezes e produziria decisão que o próximo deploy
desfaz. Cadastro `unificado` também sai, como em todo o resto do sistema.

## 6. Riscos e como cada um está contido

| Risco | Contenção |
|---|---|
| Trocar código altera etiqueta impressa e a coluna AC | histórico com código anterior, fonte, autor e data — por produto **e** por cópia |
| Cunhar duplica numeração para sempre | só item a item, só para quem não tem par no SIA, sob `pg_advisory_xact_lock` |
| Duas pessoas decidindo ao mesmo tempo | a tela manda o código que **ela viu**; o `WHERE` casa esse valor e devolve 409 |
| Dois produtos adotando o mesmo código | balde `disputado` — o lote recusa antes de gravar |
| Código de barras digitado na coluna do código | faixa 1..999.999.999 descarta a linha e ela não vira teto |
| Env nova invisível no Coolify | as cinco `GOOGLE_SHEETS_MIX_*` entraram no compose; a CI cobra |

**Não contido, e é decisão sua:** não existe índice único em
`products.codigo_interno`. Declarar um `UNIQUE(loja, codigo_interno)` agora é
arriscado — `start:prod` roda `drizzle-kit push --force` encadeado com `&&`, e
se houver duplicata em produção **a API não sobe**. A ordem segura é: rodar o
diagnóstico, resolver, e só então declarar.

```sql
SELECT loja, codigo_interno, count(*) FROM products
WHERE codigo_interno IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1;
```

## 7. O que foi provado por teste

55 testes novos. Três mutações confirmam que eles mordem:

| Mutação | Teste que caiu |
|---|---|
| força da chave volta a ser global | "chave curta não vira forte só porque o SIA tem uma etiqueta de balança" |
| trava de `disputado` removida | "dois produtos disputando o mesmo código não são adotados em lote" |
| guarda otimista relida no servidor | "recusa quando o código mudou desde que a tela carregou" |

`npm test`: 560 (API) + 91 (shared). `typecheck` limpo, build do PWA completo.

**Os testes de integração não foram rodados** (exigem Docker). O que fica sem
cobertura por isso: a transação de `trocar`, a propagação BASE→loja com
histórico, a trava de cunhagem concorrente.

## 8. Perguntas ainda abertas

1. `codigoInterno` está em `CAMPOS_HERDADOS` (`product.service.ts`), onde a loja
   só recebe o valor novo se ainda estava seguindo a BASE. Aqui a propagação é
   incondicional (DB-04). **São duas regras para o mesmo campo** — se DB-04 vale,
   `codigoInterno` deveria sair de `CAMPOS_HERDADOS`.
2. `ULTIMO_CODIGO_LEGADO_CREARE = 1325` vira letra morta depois da adoção, mas
   continua sendo o piso em banco novo/restaurado: o primeiro produto nasceria
   `01326`, fora da faixa da rede.
3. O código `12422` aparece em duas linhas da planilha MIX.
