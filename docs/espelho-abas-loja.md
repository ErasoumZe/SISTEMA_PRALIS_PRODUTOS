# Espelho nas abas de loja — o que descobri e a decisão que falta

**Pedido:** "planilha é espelho do sistema — base e abas de cada loja devem
funcionar igual". Concordo com o objetivo. Mas as abas, como estão hoje, não
comportam isso, e escrever nelas no chute corromperia milhares de linhas.

> **Correção de 03/09/2026.** A primeira versão deste documento mediu a planilha
> **errada** — a de homologação (`1OrJScm...`), que é a do `.env` local. Os
> números abaixo são da planilha **de produção** (`1C0FsF...`), a que o José
> compartilhou. O diagnóstico não mudou; o buraco é maior do que eu tinha dito.

> **Seções 1 e 2 são o diagnóstico de antes.** As colunas que faltavam já foram
> acrescentadas — o que valeu delas está resolvido a partir da seção 3.

## 1. O tamanho real da diferença

| Aba | Cabeçalhos | Tem `ID`? |
|---|---|---|
| `(BASE) CADASTRO PRODUTOS` | **158** | sim, em `FP` |
| `(TNP) CADASTRO PRODUTOS` | 65 | **não** |
| `(LI) CADASTRO PRODUTOS` | 63 | **não** (e nem `FOTO`) |

**96 cabeçalhos da BASE não existem na aba TNP.** E dos 62 que existem nas duas,
**61 estão em posição diferente**.

Ou seja: não é um deslocamento uniforme que dê para compensar com uma conta. Um
mapa por posição gravaria custo na coluna de alíquota. O mapeamento tem que ser
por NOME de cabeçalho — que é como o serviço já acha `ID` e `FOTO` hoje.

## 2. O que falta é identidade, não detalhe

Entre os 96 ausentes estão `NOME`, `QUANTIDADE`, `MEDIDA BASE` e `QT_CAD`.

A aba de loja não guarda o nome do produto — ela **deriva** a descrição na
coluna `CADASTRO PRODUTOS ATUALIZADO NOVO`. Ela foi desenhada como uma *visão*
que herda identidade de outro lugar, não como um cadastro completo.

E, decisivo: **não existe coluna `ID`**. É ela que dá idempotência ao espelho —
sem ela o sistema não sabe qual linha atualizar, e passaria a **duplicar a cada
sincronismo**.

## 3. A decisão — tomada em 03/09/2026

Você escolheu a **Opção A** e acrescentou na linha 5 das abas as colunas `NOME`,
`QUANTIDADE`, `MEDIDA BASE`, `QT_CAD` e `ID`. Com isso o espelho ficou mecânico.

Onde elas caíram (as posições são diferentes em cada aba — por isso o casamento
é por **nome**, nunca por posição):

| Aba | `ID` | `NOME` | `QUANTIDADE` | `MEDIDA BASE` | `QT_CAD` |
|---|---|---|---|---|---|
| `(TNP) CADASTRO PRODUTOS` | `CP` | `CL` | `CM` | `CN` | `CO` |
| `(LI) CADASTRO PRODUTOS` | `CG` | `CC` | `CD` | `CE` | `CF` |

`(HORA) CADASTRO PRODUTOS` também ganhou as colunas, mas **fica desligada** —
não está em `LOJAS_ESPELHADAS` nem em `ABA_PADRAO`.

## 4. O que está pronto

- `sheet-traducao.ts` — traduz um `CellMap` da BASE para outra aba casando pelo
  **nome do cabeçalho**. O que a aba de destino não tem, não é escrito (fica
  listado em `semCorrespondencia`); o que a aba ganhar depois passa a ser
  preenchido sozinho, sem mexer em código.
- `product-sheet-loja.service.ts` — acha a linha **pelo `ID`**: se já existe,
  atualiza; se não, reserva a próxima linha realmente livre. Recusa aba sem `ID`
  ou sem `NOME` (`SHEET_LOJA_SEM_ID`, 503).
- `GET /admin/sheets/loja/previsualizar` — **modo de conferência**: mostra
  célula por célula o que gravaria, e não grava nada.
- `POST /admin/sheets/loja/espelhar` — grava. Um produto por vez, por clique.

Ambas as rotas são só para `admin` e recusam produto de outra loja
(`PRODUCT_OTHER_STORE`, 422).

## 5. O que a conferência pegou antes de qualquer escrita

Rodando a conferência com um produto TNP, ela apontou a **linha 11** como livre.
Não estava: tinha código de barras `1234` e código interno `0011`.

A causa: a primeira versão decidia "linha livre" olhando só `ID` e `NOME` — as
duas colunas **recém-criadas**, e portanto vazias em todas as linhas que a loja
já tinha. O espelho gravaria por cima de uma linha existente.

Agora uma linha só é considerada livre quando `ID` **e** todas as colunas de
identidade que a aba já usa (`NOME`, `CODIGO BARRAS`, `CODIGO INT.`,
`CADASTRO PRODUTOS ATUALIZADO NOVO`) estão vazias. O caso está travado por
teste: `NÃO toma linha ocupada só pelas colunas antigas`.

## 6. Quanta coisa há nas abas hoje

Medido em 03/09/2026 na planilha de produção:

| Aba | Grade (`rowCount`) | Linhas com produto |
|---|---|---|
| `(BASE) CADASTRO PRODUTOS` | 9.930 | 161 |
| `(TNP) CADASTRO PRODUTOS` | 9.930 | 4 |
| `(LI) CADASTRO PRODUTOS` | 9.930 | 4 |
| `(HORA) CADASTRO PRODUTOS` | 9.930 | 1 |

**9.930 é o tamanho da grade, não a quantidade de produtos.** Eu troquei as duas
coisas em análises anteriores; as abas de loja têm 4 linhas de teste cada.

## 7. As 4 linhas antigas não têm `ID`

As linhas que já estavam nas abas foram digitadas à mão e não têm `ID`. O
espelho não tem como saber que o produto X do Pralis é a linha 12 da aba — então
ele **acrescenta uma linha nova** em vez de atualizar aquela.

Com 4 linhas de teste isso é irrelevante. Fica registrado porque a mesma
situação apareceria de novo se a loja digitasse produtos direto na aba.

## 8. Duas planilhas — cuidado ao investigar

Existem duas, e elas divergem:

| | ID | Onde aparece |
|---|---|---|
| Produção | `1C0FsFMZelHN1Il3xmoI7E5EStgr_8MpgYz0aJ-X2y2w` | Coolify, e o link que o José compartilhou |
| Homologação | `1OrJScm9YiRLYgWIoshHDsRVehwwsgsoT1uSrnfod09A` | `.env` local de desenvolvimento |

Na de homologação a aba de grupos está `#REF!` e a BASE tem 74 cabeçalhos; na de
produção a aba de grupos está sã e a BASE tem 158. **Conferir sempre qual das
duas está sendo lida antes de concluir qualquer coisa.**
