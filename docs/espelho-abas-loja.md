# Espelho nas abas de loja — o que descobri e a decisão que falta

**Pedido:** "planilha é espelho do sistema — base e abas de cada loja devem
funcionar igual". Concordo com o objetivo. Mas as abas, como estão hoje, não
comportam isso, e escrever nelas no chute corromperia 9.930 linhas.

Levantado em 03/09/2026 lendo os cabeçalhos reais (linha 5).

## 1. As posições NÃO são um deslocamento uniforme

A primeira impressão é que a aba da loja é a BASE deslocada 4 colunas (ela não
tem `LOJAS`, `NOME`, `QUANTIDADE`, `MEDIDA BASE`). Não é:

| Cabeçalho | BASE | TNP |
|---|---|---|
| `CADASTRO PRODUTOS ATUALIZADO NOVO` | H | D |
| `COMO SE COMPRA ESSE PRODUTO?` | P | **Z** |
| `V. VENDA` | AO | **AR** |
| `PROMOÇÃO DESC. %` | AX | **AV** |
| `REDUCAO_ICMS` | BS | **CB** |

O desvio muda ao longo da aba. **Um mapa por posição gravaria dado na coluna
errada** — custo caindo em alíquota, por exemplo. O mapeamento tem que ser
por NOME de cabeçalho, como o serviço já faz para achar `ID` e `FOTO`.

## 2. Faltam 10 colunas na aba da loja

De 74 cabeçalhos da BASE, a aba da loja tem 65. Não existem lá:

```
LOJAS · NOME · QUANTIDADE · MEDIDA BASE · QT_CAD
QUAL A QUANTIDADE QUE TEM DENTRO DESSE PRODUTO? · QT_TR
REF COMO SE COMPRA ESSE PRODUTO? · V. VENDA PROMO · PROMOÇÃO DESC. %%
```

E, o mais importante: **não existe coluna `ID`**. A aba vai até `CK = FOTO`; na
BASE o `ID` está em `CP`, e é ele que dá idempotência ao espelho — sem ele o
sistema não sabe qual linha atualizar e passaria a duplicar a cada sincronismo.

## 3. A consequência

`NOME`, `QUANTIDADE` e `MEDIDA BASE` são identidade do produto. A aba da loja
não guarda nenhum dos três — ela **deriva** a descrição na coluna
`CADASTRO PRODUTOS ATUALIZADO NOVO`. Ou seja: a aba de loja foi desenhada como
uma *visão* que herda identidade de outro lugar, não como um cadastro completo.

Escrever um produto novo lá sem essas colunas deixaria a linha sem nome.

## 4. A decisão que preciso de você

**Opção A — igualar as abas (recomendo).** Acrescentar nas três abas de loja as
colunas que faltam, com o mesmo nome de cabeçalho da BASE, incluindo `ID`. A
partir daí o espelho é mecânico e funciona igual em todas.

Mínimo indispensável para funcionar: **`ID`, `NOME`, `QUANTIDADE`,
`MEDIDA BASE`, `QT_CAD`** (as outras 5 são de promoção e referência).

**Opção B — espelhar só o que a aba já tem.** Funciona sem tocar na estrutura,
mas produto novo aparece sem nome e sem quantidade, e a coluna de descrição
depende de fórmula que talvez não resolva sozinha. Continua precisando do `ID`.

Em qualquer das duas, **a coluna `ID` é obrigatória** — é o que impede
duplicação.

## 5. O que eu já deixei pronto

- O serviço descobre `ID`/`FOTO`/`HABILITAR AJUDA` **por nome de cabeçalho**, e
  não por posição — então já está preparado para abas com layout diferente.
- O `GOOGLE_SHEETS_DEFAULT_LOJAS` e a estrutura de configuração por aba já
  existem.

Falta o mapa por nome dos ~40 campos e a configuração por loja. Assim que você
disser A ou B (e acrescentar as colunas, se for A), isso é uma fatia curta — e
eu faço com um modo de conferência que mostra célula por célula o que ele
gravaria, antes de gravar de verdade.

## 6. Por que eu não fiz agora

Escrever numa aba de produção com 9.930 linhas, com mapa deduzido de um
cabeçalho parcial e sem cópia para testar, é o tipo de erro que não se desfaz
com um botão. Preferi trazer a evidência e a decisão.
