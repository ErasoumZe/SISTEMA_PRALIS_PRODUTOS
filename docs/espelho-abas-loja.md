# Espelho dos produtos por loja

> **Atualização de 10/09/2026 — leiaute atual.** A planilha hoje usada é
> `1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw`, cuja aba principal é
> `(TNP/LI) CADASTRO PRODUTOS`. Nela, BASE, TNP e LI compartilham a mesma linha:
> os dados gerais ficam uma vez e cada loja tem sua própria faixa lateral.
> Portanto, importar/editar LI ou TNP deve atualizar essa mesma linha, localizada
> pelo `baseProductId`.
>
> **Correção de 10/09/2026.** Escrevi aqui que as abas `(TNP) CADASTRO PRODUTOS`
> e `(LI) CADASTRO PRODUTOS` eram "projeções" do cadastro combinado. Não são.
> Medido na planilha: o nome do produto está nelas como **valor literal**, não
> como fórmula, e das 1.188 linhas com produto **1.187 têm nome idêntico nas
> três abas** — a única divergente era justamente a linha que o sistema criou
> escrevendo só na combinada. Elas são **cópias linha a linha**, e nada as
> alimenta sozinho. Quem escreve na combinada tem de escrever nelas, na mesma
> linha, ou o alinhamento quebra a partir dali.
>
> O fluxo antigo descrito abaixo — escrita direta nas abas dedicadas, controlada
> por `GOOGLE_SHEETS_LOJA_ESPELHO_AUTO` — permanece somente como compatibilidade
> para o leiaute anterior. **Não se deve ligar essa chave para corrigir a planilha
> nova.** Em 10/09/2026 ela estava vazia/desligada no Coolify, e as colunas
> `ID`/`NOME` citadas abaixo não estavam presentes nas posições do documento.

## Fluxo vigente

1. O cadastro novo é criado na BASE e ganha uma linha na aba combinada.
2. Ao importar para LI/TNP, a cópia no Postgres guarda `baseProductId`.
3. A importação em lote localiza a linha por esse ID e preenche apenas a faixa
   da loja; uma edição posterior repete a sincronização de forma idempotente.
4. **Na mesma linha**, as abas `(TNP)` e `(LI) CADASTRO PRODUTOS` recebem as
   colunas gerais — sempre, inclusive para produto da BASE — e a faixa da loja
   só na aba daquela loja. É `espelharNasAbasDeLoja`.
5. Se a planilha detectada for a antiga, o sistema recorre ao espelho dedicado.

## O que o sistema nunca sobrescreve

Colunas que a própria linha calcula (`C/DE`, `COMO SE COMPRA`, `MARGEM GRUPO %`,
`V. VENDA`, `SETOR VENDA…`) são lidas antes de cada gravação e **puladas**.
Gravar valor por cima de fórmula a apaga para sempre naquela linha: foi o que
aconteceu na linha 1198, onde `C/DE` virou o texto solto `DE` e `COMO SE COMPRA`
virou texto fixo, enquanto as outras 1.187 linhas seguiam calculando. Como o
guarda lê a linha de destino depois de `garantirFormulas`, uma linha já estragada
se conserta sozinha no salvamento seguinte.

## Histórico do leiaute anterior

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

## 5. Espelho automático — pronto, e desligado

`GOOGLE_SHEETS_LOJA_ESPELHO_AUTO` (padrão `false`). Ligado, o espelho roda
sozinho em dois momentos:

- **importação da BASE** para a loja (`POST /products/import`) — o caso do
  pedido original: quem é da TNP importa e os produtos aparecem na aba dela;
- **edição** de um produto de loja.

Em **lote**, de propósito: uma leitura de leiaute, uma de ocupação e duas
escritas para a importação inteira. Produto a produto, importar 500 itens seriam
~1.500 chamadas ao Google e a cota estouraria muito antes do fim.

O lote decide as linhas **em memória**. Sem isso, dois produtos novos da mesma
importação leriam a planilha no mesmo estado, veriam a mesma primeira linha
livre e o segundo gravaria em cima do primeiro — dentro da mesma importação,
sem ninguém perceber. Travado por teste (`buracos DIFERENTES do meio da aba`).

Falha do Google vira `'falhou'` e **nunca** estoura para quem cadastrou: o
produto já está salvo no Postgres quando o espelho roda. O resultado volta no
corpo da resposta da importação, em `espelhoLoja`.

## 6. O que a conferência pegou antes de qualquer escrita

Rodando a conferência com um produto TNP, ela apontou a **linha 11** como livre.
Não estava: tinha código de barras `1234` e código interno `0011`.

A causa: a primeira versão decidia "linha livre" olhando só `ID` e `NOME` — as
duas colunas **recém-criadas**, e portanto vazias em todas as linhas que a loja
já tinha. O espelho gravaria por cima de uma linha existente.

Agora uma linha só é considerada livre quando `ID` **e** todas as colunas de
identidade que a aba já usa (`NOME`, `CODIGO BARRAS`, `CODIGO INT.`,
`CADASTRO PRODUTOS ATUALIZADO NOVO`) estão vazias. O caso está travado por
teste: `NÃO toma linha ocupada só pelas colunas antigas`.

## 7. Quanta coisa há nas abas hoje

Medido em 03/09/2026 na planilha de produção:

| Aba | Grade (`rowCount`) | Linhas com produto |
|---|---|---|
| `(BASE) CADASTRO PRODUTOS` | 9.930 | 161 |
| `(TNP) CADASTRO PRODUTOS` | 9.930 | 4 |
| `(LI) CADASTRO PRODUTOS` | 9.930 | 4 |
| `(HORA) CADASTRO PRODUTOS` | 9.930 | 1 |

**9.930 é o tamanho da grade, não a quantidade de produtos.** Eu troquei as duas
coisas em análises anteriores; as abas de loja têm 4 linhas de teste cada.

## 8. As 4 linhas antigas não têm `ID`

As linhas que já estavam nas abas foram digitadas à mão e não têm `ID`. O
espelho não tem como saber que o produto X do Pralis é a linha 12 da aba — então
ele **acrescenta uma linha nova** em vez de atualizar aquela.

Com 4 linhas de teste isso é irrelevante. Fica registrado porque a mesma
situação apareceria de novo se a loja digitasse produtos direto na aba.

## 9. Duas planilhas — cuidado ao investigar

Existem duas, e elas divergem:

| | ID | Onde aparece |
|---|---|---|
| Produção | `1C0FsFMZelHN1Il3xmoI7E5EStgr_8MpgYz0aJ-X2y2w` | Coolify, e o link que o José compartilhou |
| Homologação | `1OrJScm9YiRLYgWIoshHDsRVehwwsgsoT1uSrnfod09A` | `.env` local de desenvolvimento |

Na de homologação a aba de grupos está `#REF!` e a BASE tem 74 cabeçalhos; na de
produção a aba de grupos está sã e a BASE tem 158. **Conferir sempre qual das
duas está sendo lida antes de concluir qualquer coisa.**
