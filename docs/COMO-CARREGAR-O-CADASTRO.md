# Como carregar o cadastro — passo a passo

> 20/09/2026. Para quem vai **operar** as telas, não para quem vai mexer no código.
> Cinco etapas. Nenhuma roda sozinha no deploy: nada acontece até você conferir a
> prévia e clicar. Toda tela tem prévia que não grava.

---

## “Só atualiza o que já está cadastrado, né?”

Sim. Conferido campo por campo no código — é isto que cada tela escreve, e nada além:

| Etapa | Escreve em | O que faz |
|---|---|---|
| 01 · De-para | `sia_produto_depara` | **não encosta em produto nenhum** |
| 02 · Código | `products.codigo_interno` | troca só esse campo, com histórico |
| 03 · Importar | `products` | **só cria — não tem `UPDATE` nenhum** |
| 04 · Custo | `products.custo` | troca só esse campo |

**Nenhuma delas apaga produto.** Nome, foto, grupo, fiscal, margem, preço de venda,
estoque — nada disso é tocado. A importação, em especial, *não tem caminho de
alteração*: ela só sabe criar o que não existe. O que já está lá é reconhecido pelo
código interno ou pelo código de barras e **pulado**, com o motivo à vista na prévia.

---

## 01 · De-para do SIA

**`/produtos/depara-sia`** · uma vez por loja · **não toca no cadastro**

### Por que primeiro

É a régua. O código do produto no Pralis tem que ser igual ao `coditem` do SIA —
quando divergem, o gerador do TXT recusa o produto e ele some da exportação para o
PDV, sem aviso. A etapa 02 não tem o que propor sem isto.

### Como fazer

1. Escolha a loja. **Confira duas vezes** — é o único campo desta tela que não dá
   para validar por você; o arquivo do SIA não tem coluna de loja dentro.
2. Envie o `.xls` do SIA Supervisor **daquela** loja.
3. Clique **Conferir**. Nada é gravado ainda.
4. Compare com a tabela abaixo.
5. Digite `SUBSTITUIR O DE-PARA DESTA LOJA` e grave.
6. Repita para a segunda loja, com a exportação dela.

### O que o `exportacaoSIAATUALIZADO.xls` já mostrou

Rodado pelo parser do próprio sistema. Se a tela mostrar isto, está certo:

| Cartão | Valor |
|---|---|
| Do catálogo | **2.968** |
| De entrega, fora | 1.205 |
| Sem barras | 19 |
| Faixa do catálogo | **10000 – 13126** |
| Travas | nenhuma → liberado |

### A entrega sai sozinha

As 1.205 linhas de delivery ficam de fora automaticamente, **pelo código**
(`≥ 700000`) e não pelo nome — porque o SIA trunca a descrição e a palavra
“DELIVERY” some em 216 delas. Você não precisa filtrar nada antes de enviar.

---

## 02 · Código de cadastro

**`/produtos/codigo-cadastro`** · 448 produtos na lista · **troca 1 campo, com histórico**

### O que ela muda

Só o `codigo_interno`. Cada troca grava o código anterior, quem fez e quando —
**dá para desfazer**. As cópias das lojas recebem o mesmo código da Base, também
com histórico próprio.

### Os números medidos

| Grupo | Quantos | O que fazer |
|---|---|---|
| Pronto para adotar | **113** | Botão único. Clique até zerar. |
| **Dois cadastros, um código** | **221** | **Pare aqui.** Ver 02-A. |
| Precisa de você / sem par | ~114 | Um por vez, depois da etapa 03. |

> A lista tem 448, não 944: cópia de loja não entra, porque ela herda o código da
> Base. (Eu tinha dito “~753” antes — estava contando as cópias junto.)

### Como fazer

1. Digite `RECONCILIAR CODIGO DE CADASTRO` uma vez.
2. Clique **Adotar** no grupo “Pronto para adotar”, em lotes de 200.
3. Recarregue e repita até zerar.
4. Deixe “sem par no SIA” para **depois** da etapa 03.

---

## 02-A · Unificar os duplicados

**Central de Produtos** · a etapa que não estava prevista

**221 dos 448 produtos da Base são duplicados entre si** — mesmo código de barras,
cadastros diferentes. A tela de código recusa numerar todos eles, e está certa: dar
o mesmo código do PDV a dois cadastros quebra o TXT.

Isso é trabalho da **Central de Produtos**, não da tela de código. Abra a Central e
unifique os duplicados antes de continuar.

É **a única etapa de todo o processo que muda o cadastro de verdade** — e é decisão
sua, grupo a grupo.

---

## 03 · Importar da planilha

**`/produtos/importar-mix`** · **cria cadastro novo**

### O que ela NÃO faz

Não altera nenhum produto existente. O código dela não tem um `UPDATE` sequer.

### Por que depois da 02

Ela reconhece o que já existe olhando código interno e código de barras. Com os
códigos ainda desalinhados, ela não reconheceria produtos que *já estão lá* — e
criaria tudo de novo.

### Leia “quem fica de fora” antes de clicar

É o número mais importante da tela, mais que o “quantos entram”. O que a planilha
não traz entra **vazio**, nunca chutado.

- **Já cadastrado** — normal, é a etapa 02 tendo funcionado.
- **Sem descrição** — linha de legenda ou total.
- **Unidade desconhecida** — se vier alto, me chame: tem coluna nova na aba.
- **Sem IPPT** — sem ele não dá para saber se é revenda ou produção.

### Como fazer

1. Digite `IMPORTAR PRODUTOS DA PLANILHA`.
2. Clique. Vai em lotes de 100 — **repetir continua de onde parou e não duplica**.
3. A tela diz quantos faltam a cada rodada. Repita até zerar.
4. Volte à etapa 02 e resolva “sem par no SIA”, agora com o cadastro completo.
5. Rode a **carga fiscal** em Manutenção: os novos nascem sem fiscal de propósito,
   porque ele vem da fonte aprovada e não da planilha.

---

## 04 · Custo da discriminação

**`/produtos/custo-discriminacao`** · **troca 1 campo, sem histórico**

### Consertando a primeira carga

A primeira rodada gravou custo errado: o valor **unitário** da nota foi escrito num
campo que significa **custo da embalagem**, e o sistema dividia de novo pela
quantidade. O PR #67 corrigiu e já está na `main`.

**Rodar esta tela de novo conserta** — ela compara com o valor atual e propõe a
correção em cima do errado.

### Confira três produtos de cabeça

A amostra mostra a conta: `R$ 4,31 × 24` ao lado do valor novo. Pegue três produtos
que você conhece e divida o custo novo pela embalagem. **Se não for o que você paga
por unidade, pare.**

### O que ela não faz

Grava **custo, não preço**. O preço só muda nos produtos com “Calcular venda
automático” ligado. Se *V. Venda (calculado)* aparece R$ 0,00, é porque esse botão
está desligado naquele produto — **não é erro**.

### Como fazer

1. Digite `ATUALIZAR CUSTO DA DISCRIMINACAO`.
2. Clique. Vai em lotes de 300, repetindo até zerar.

### Pergunta ainda aberta

Das quatro planilhas compartilhadas, o custo está sendo lido da
**DISCRIMINAÇÃO/ESTOQUE (MER)**. A de **LANÇAMENTOS (VND/CT/DES/MER/RET)** não está
sendo usada em lugar nenhum. Se o custo devia sair de lá, avise **antes** desta etapa.

---

## Resumo da ordem

1. **De-para** — LI e TNP, uma exportação cada.
2. **Código** — adotar os 113.
3. **Central** — unificar os 221 duplicados.
4. **Código de novo** — os que destravaram.
5. **Importar** — o que falta, em lotes de 100.
6. **Código mais uma vez** — “sem par”, com o cadastro completo.
7. **Carga fiscal** — os produtos novos.
8. **Custo** — corrigindo a primeira carga.

---

**Se qualquer número parecer estranho, pare.** Prévia não grava — olhar duas vezes é
de graça, e desfazer numeração cunhada não é.

Etapas 01 a 03 registram histórico ou só criam. A 04 troca custo sem histórico — só
se corrige rodando de novo.
