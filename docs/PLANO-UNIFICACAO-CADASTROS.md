# Unificação de cadastros duplicados — plano de ação

> Escrito em 26/08/2026 a partir da leitura do código em
> `homologacao/cadastro-produtos-2026-08-25` (HEAD `4526c52`).
> Destinado ao Claude Code. Tudo que está marcado **VERIFICADO** foi lido no
> código, não suposto.

---

## 1. A distinção que muda o desenho inteiro

O pedido do José foi: *"acabar com a existência de mais de um cadastro do mesmo
produto, ou mesmo, cadastros diferentes nas lojas"*.

**A segunda metade dessa frase não é um defeito — é o modelo.** VERIFICADO em
`product.table.ts`:

```ts
loja: text('loja').notNull(),          // 'BASE' | 'TNP' | 'LI' | 'HORA'
baseProductId: text('base_product_id'),
custo: numeric('custo', ...),          // cada loja tem o SEU
```

Cada loja tem a sua linha, com o seu custo, o seu preço e as suas promoções.
A Coca 2L da TNP e a Coca 2L da LI **não são duplicatas** — são o mesmo produto
com números diferentes, e é assim que tem que ser. Fundir as duas destruiria a
margem e faria uma loja enxergar o cadastro da outra. O código já defende isso
em `vendas-depara.service.ts`:

```ts
if (produto.loja !== loja) {
  throw new AppError('O produto precisa ser da mesma loja da venda.', 422, 'PRODUCT_OTHER_STORE');
}
```

**DECISÃO DO JOSÉ — FECHADA em 31/08/2026:** fundir SÓ dentro da mesma loja
(caso **D1**). NÃO fundir entre lojas — a Coca da TNP e a Coca da LI têm custo e
preço próprios e continuam cadastros distintos. O código já protege isso
(`PRODUCT_OTHER_STORE`) e deve continuar protegendo. Ordem de ataque: **D1
primeiro**, depois **D2** (ligar loja↔BASE), e **D3** (fundir dois BASE) fica
fora do escopo por ora — só se o José pedir explicitamente no futuro.

### Os três casos reais

| # | Caso | O que fazer | Risco |
|---|---|---|---|
| **D1** | Duas linhas na **mesma loja** que são o mesmo produto (`coca cola 2L` e `refri-coca cola 2L`, ambas em TNP) | **Fundir**: uma sobrevive, a outra é aposentada | alto — apaga dado |
| **D2** | Produto de loja com `baseProductId` nulo que deveria pendurar num produto BASE | **Ligar**, não fundir | baixo — só preenche um campo |
| **D3** | Dois produtos **BASE** que são o mesmo | **Fundir** e reapontar os filhos das três lojas | o mais alto de todos |

O que o José descreveu como "escolher qual nome manter" é o **D1**. É por onde
começar. O **D3** fica por último.

---

## 2. O que já existe e deve ser reaproveitado, não reescrito

Tudo abaixo está no repositório, testado, em produção.

### `semelhanca(a, b)` — `modules/vendas/vendas-margem.ts:137`
Dice por bigramas, devolve 0 a 100. Normaliza acento, caixa e pontuação antes
de comparar. É exatamente o motor do "ver o que é semelhante por meio de nome".
**Não escreva outro.**

### `barcodeCandidates(barcode)` — `modules/apoio/tax-rule.service.ts`
Gera as chaves de um código de barras, incluindo o PLU de balança (EAN de 13
dígitos começando em `2` → `slice(1,6)`). É o que faz pão, salgado e granel
casarem sozinhos.

### `indexarPorCodigo(produtos)` — `vendas-margem.ts:36`
**Achado importante:** essa função já detecta os duplicados por código de
barras e joga a informação fora.

```ts
const existente = indice.get(chave);
if (existente && existente.id !== produto.id) {
  ambiguas.add(chave);   // <-- ISTO é a lista de duplicatas por barras
  continue;
}
...
for (const chave of ambiguas) indice.delete(chave);
```

O conjunto `ambiguas` **é** o relatório do caso fácil, já calculado a cada
requisição. Expor isso é quase de graça e entrega valor na primeira fatia.

### `ProductRules.montarDescricao(nome, quantidade, medidaBase)` — `@pralis/shared`
O nome canônico de exibição. `vendas-depara.service.ts` compara contra os dois
(`nome` cru e descrição montada) e fica com o maior. Faça igual.

### O padrão de UX do de-para — `vendas-depara.controller.ts` / `.service.ts`
Sugerir → **uma pessoa confirma** → gravar `confirmadoPor` e `confirmadoEm`.
Nada é vinculado automaticamente. Esse é o modal que o José descreveu, e já
existe funcionando. Copie a forma.

---

## 3. Os perigos — todos VERIFICADOS no código

### 3.1 Apagar o perdedor destrói o trabalho manual do de-para

`products.id` é referenciado com `onDelete: 'cascade'` por:

- `product_transformacao`
- `product_fiscal`
- `promocoes`
- **`produto_creare`** ← esta é a que dói

`produto_creare` guarda os vínculos venda↔produto que uma pessoa confirmou a
mão, um a um, na tela de de-para. Um `DELETE` no produto perdedor apaga esses
vínculos em silêncio e o faturamento volta a cair em "sem produto".

**Regra: reaponte `produto_creare` do perdedor para o vencedor ANTES de
qualquer coisa.** E cuidado com o índice único
`uq_produto_creare_natural (loja, produto_codigo, produto)`: se os dois
produtos tinham vínculo para o mesmo código, o reaponte colide. Trate com
`ON CONFLICT DO NOTHING` e descarte o do perdedor.

### 3.2 `baseProductId` não tem chave estrangeira

```ts
baseProductId: text('base_product_id'),   // sem .references()
```

Fundir um produto BASE **não** dá erro nem cascata: simplesmente deixa os
filhos das três lojas apontando para um id que não existe mais, sem nenhum
aviso. No caso D3, reaponte os filhos explicitamente, dentro da mesma
transação.

### 3.3 A exclusão espelha na planilha

VERIFICADO em `product.service.ts:285` — `delete()` chama
`this.sheets.removeProduct(id)`. Uma unificação que não espelhe deixa o produto
fantasma vivo na planilha, e o José confere pela planilha.

### 3.4 Não existe índice único em `codigo_barras`

A tabela só tem `idx_products_loja`, não-único. É por isso que as duplicatas
existem. Enquanto não houver a restrição, elas continuam nascendo — por isso a
fatia 5 (prevenir) não é opcional.

---

## 4. Decisão de desenho recomendada: unificar não apaga

Não faça `DELETE` no perdedor. Em vez disso:

1. `products.status = 'unificado'` (o campo já existe, hoje só usa `'ativo'`);
2. uma coluna nova `unificadoEmProductId` apontando para o vencedor;
3. uma tabela `product_merge` de auditoria: vencedor, perdedor, quem, quando, e
   um **snapshot JSON da linha inteira do perdedor** (produto + fiscal +
   transformação + promoções).

Com isso o desfazer existe. Sem isso, o primeiro clique errado é permanente — e
quem vai clicar é uma pessoa cansada às seis da tarde.

Filtrar `status <> 'unificado'` em todas as listagens e no espelho da planilha.
O `DELETE` de verdade, se um dia fizer sentido, vira uma faxina separada e
consciente.

---

## 5. As fatias

### Fatia 1 — Diagnóstico, sem botão de fundir

- [ ] Endpoint `GET /produtos/duplicados?loja=` que devolve, **sem alterar nada**:
  - [ ] **por código de barras** — reaproveitar o `ambiguas` de `indexarPorCodigo`
  - [ ] **por código interno** repetido dentro da mesma loja
  - [ ] **por semelhança de nome** acima de um piso, dentro da mesma loja
  - [ ] **sem BASE** — produtos de loja com `baseProductId` nulo (caso D2)
- [ ] Cada grupo traz: os produtos, o que difere entre eles (custo, NCM, CST,
      alíquota, preço) e **o faturamento dos últimos 90 dias de cada um**,
      cruzando com `venda_produto_dia` via `produto_creare`
- [ ] Tela só de leitura, ordenada por **faturamento**, não por semelhança
- [ ] Nenhum botão de ação nesta fatia

**Por que assim:** ninguém sabe hoje se são 12 duplicatas ou 1.200. O número
decide se a fatia 3 precisa de ação em lote ou se um modal por vez basta. É a
mesma lógica que fez o rollout vir antes da margem.

**Ordenar por faturamento e não por semelhança** é o ponto que faz a tela ser
usada: o que importa é a duplicata que move dinheiro, não a que é mais parecida.

### Fatia 2 — Unificar por código de barras (o caso fácil)

Mesmo código de barras + mesma loja = mesmo produto, por definição. O José
disse: *"o que for igual por código de barras só escolhe o nome que quer
manter"*.

- [ ] Modal: os dois (ou N) cadastros lado a lado, campo a campo
- [ ] Admin escolhe **qual linha sobrevive** — e não campo a campo, que é onde
      esse tipo de tela vira um formulário que ninguém termina
- [ ] **Destacar em vermelho todo campo que difere.** A premissa "os dados se
      mantêm já que são iguais" precisa ser conferida, não assumida: se o custo
      ou a alíquota diferem, eles não eram iguais
- [ ] Bloquear a unificação quando **fiscal** diverge (NCM, CST, alíquota) até
      o admin escolher explicitamente qual vale — mesmo princípio de nunca
      inventar alíquota
- [ ] Transação: reaponta `produto_creare` → reaponta filhos `baseProductId` →
      marca perdedor como `unificado` → grava `product_merge` → espelha na planilha
- [ ] Só admin (siga o padrão do `delete`, que já é exclusivo de admin)

### Fatia 3 — Unificar por semelhança (o caso julgado)

- [ ] Mesma tela, alimentada por `semelhanca()` em vez do código de barras
- [ ] Piso de semelhança configurável; começar alto (75+) e baixar com o uso
- [ ] Deixar claro na tela que aqui é **sugestão**, não fato — o de-para de
      vendas já usa esse tom, reaproveite
- [ ] Botão **"não são o mesmo"**, que grava a recusa e não sugere de novo.
      Sem isso o mesmo par volta toda semana e a tela perde a confiança
- [ ] Só entrar em lote se a fatia 1 mostrar volume que justifique

### Fatia 4 — Ligar loja ↔ BASE (caso D2)

- [ ] Para cada produto de loja sem `baseProductId`, sugerir o BASE por código
      de barras e por nome
- [ ] Ligar preenche o campo. **Não copia custo nem preço** — esses são da loja
- [ ] Aproveitar a herança BASE→lojas que o commit `92627e0` já implementou

### Fatia 5 — Impedir que nasçam de novo

- [ ] No cadastro, ao digitar o código de barras: avisar na hora se já existe
      naquela loja
- [ ] Ao salvar com nome parecido com um existente: aviso, não bloqueio
- [ ] Índice único parcial em `(loja, codigo_barras)` onde `codigo_barras` não é
      nulo nem vazio — **só depois** de a fatia 2 limpar o que já existe, senão
      o `drizzle-kit push` falha ao subir

---

## 6. Decisões do José — FECHADAS em 31/08/2026

Todas respondidas. Não perguntar de novo.

1. **Fundir entre lojas: FORA.** DECIDIDO. Só duplicatas dentro da mesma loja
   (D1). TNP e LI mantêm cadastros próprios; o código continua barrando com
   `PRODUCT_OTHER_STORE`.
2. **Custo diferente: vence o do cadastro vencedor.** DECIDIDO (seguindo a
   recomendação). A diferença aparece na tela, em vermelho, antes de confirmar.
3. **Vigência: RETROATIVO, vale para todo o histórico.** DECIDIDO. Justificativa
   verificada no código: a margem já é recalculada na hora a partir do custo
   atual do cadastro (`vendas-margem.ts` lê `produto.custo` no momento do
   relatório; não há custo gravado na linha da venda). Logo, editar um custo hoje
   já move a margem de meses passados — unificar é a MESMA classe de mudança, não
   um risco novo. O que se move é a margem POR PRODUTO, não o fechamento de caixa
   (receita por PDV/operador, que independe do cadastro). Desenho SIMPLES: tabela
   de vínculo SEM data de vigência. NÃO implementar vigência por data.
4. **Quem unifica: só admin.** DECIDIDO (seguindo a recomendação), como já é a
   exclusão.
5. **Refletir no Creare: NÃO por ora.** `CREARE_EXPORT_ENABLED=false`, travado na
   alíquota ECF. Quando destravar, unificar entra na lista do que espelhar lá —
   mas isso é trabalho de outra fase, não desta.

---

## 7. Ordem sugerida e o que entregar em cada parada

| Fatia | Entrega visível | Risco |
|---|---|---|
| 1 | Uma tela que diz **quantas duplicatas existem e quanto elas valem** | nenhum |
| 2 | O admin unifica as iguais por código de barras | médio, com desfazer |
| 5 (índice) | Não nascem mais duplicatas por código de barras | baixo |
| 3 | O admin julga as parecidas | médio |
| 4 | Catálogo BASE ligado às lojas | baixo |

A fatia 1 sozinha já é entrega: hoje ninguém sabe o tamanho do problema.

---

## 8. Regras que continuam valendo

- Nunca commitar direto na `main` sem intenção — o Coolify publica sozinho.
  **Não existe ambiente de homologação separado**; a `main` é produção.
- Nunca inventar alíquota, CST ou NCM. Recusar com erro claro é o certo.
- Não desligar o espelho na planilha — é a camada de conferência do José.
- Migrations desta entrega devem ser aditivas. Se o `push` propuser
  `DROP` ou `ALTER` de coluna existente, parar e investigar.
