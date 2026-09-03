# Espelho nas abas de loja — o que descobri e a decisão que falta

**Pedido:** "planilha é espelho do sistema — base e abas de cada loja devem
funcionar igual". Concordo com o objetivo. Mas as abas, como estão hoje, não
comportam isso, e escrever nelas no chute corromperia milhares de linhas.

> **Correção de 03/09/2026.** A primeira versão deste documento mediu a planilha
> **errada** — a de homologação (`1OrJScm...`), que é a do `.env` local. Os
> números abaixo são da planilha **de produção** (`1C0FsF...`), a que o José
> compartilhou. O diagnóstico não mudou; o buraco é maior do que eu tinha dito.

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

## 3. A decisão que preciso de você

**Opção A — igualar as abas (recomendo).** Acrescentar nas três abas de loja as
colunas que faltam, com o mesmo nome de cabeçalho da BASE. A partir daí o
espelho é mecânico e funciona igual em todas.

Mínimo indispensável: **`ID`, `NOME`, `QUANTIDADE`, `MEDIDA BASE`, `QT_CAD`**.
As outras 91 são de compra, promoção e referência, e podem entrar depois.

**Opção B — espelhar só o que a aba já tem.** Não mexe na estrutura, mas produto
novo aparece sem nome e sem quantidade. Continua precisando do `ID`.

Em qualquer das duas, **a coluna `ID` é obrigatória**.

## 4. O que já está pronto

- O serviço descobre `ID`/`FOTO`/`HABILITAR AJUDA` **por nome de cabeçalho**, e
  não por posição — já preparado para abas com layout diferente.
- A configuração por aba e o `GOOGLE_SHEETS_DEFAULT_LOJAS` já existem.

Falta o mapa por nome dos ~40 campos e a configuração por loja. Assim que você
disser A ou B (e acrescentar as colunas, se for A), é uma fatia curta — e eu
faço com um modo de conferência que mostra célula por célula o que gravaria,
antes de gravar de verdade.

## 5. Por que eu não fiz agora

Escrever numa aba de produção com milhares de linhas, com mapa deduzido de
cabeçalho e sem cópia para testar, é o tipo de erro que não se desfaz com um
botão. Preferi trazer a evidência e a decisão.

## 6. Duas planilhas — cuidado ao investigar

Existem duas, e elas divergem:

| | ID | Onde aparece |
|---|---|---|
| Produção | `1C0FsFMZelHN1Il3xmoI7E5EStgr_8MpgYz0aJ-X2y2w` | Coolify, e o link que o José compartilhou |
| Homologação | `1OrJScm9YiRLYgWIoshHDsRVehwwsgsoT1uSrnfod09A` | `.env` local de desenvolvimento |

Na de homologação a aba de grupos está `#REF!` e a BASE tem 74 cabeçalhos; na de
produção a aba de grupos está sã e a BASE tem 158. **Conferir sempre qual das
duas está sendo lida antes de concluir qualquer coisa.**
