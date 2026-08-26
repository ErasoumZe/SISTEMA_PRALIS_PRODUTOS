# Integração Postgres → Google Sheets (etapa 1: criação na BASE)

> Estado: implementado, **desligado por padrão** (`GOOGLE_SHEETS_ENABLED=false`).
> O Postgres continua sendo a fonte principal. A planilha é um **espelho**.

## O que esta etapa faz

Quando o admin cadastra um produto novo (sempre na BASE), a API:

1. grava o produto **e** um registro `pending` em `product_sheet_sync` na **mesma transação**;
2. depois do commit, tenta escrever a linha na aba `(BASE) CADASTRO PRODUTOS`;
3. se o Google falhar, o produto **continua salvo** — o registro fica `failed`,
   `attempts` sobe, `last_error` guarda a mensagem sanitizada e a tela mostra
   "Produto salvo no banco. Sincronização com a planilha pendente".

### Destino da escrita é sempre explícito

`GOOGLE_SHEETS_SPREADSHEET_ID` **não tem valor padrão no código**. Havia aqui o
ID da planilha oficial como fallback: bastava ligar `GOOGLE_SHEETS_ENABLED` sem
informar o ID para a API começar a escrever em produção. Removido.

Com a integração ligada e sem destino configurado, a sincronização é **recusada
antes de qualquer chamada ao Google** — o resultado é `misconfigured`, distinto
de `disabled` para que erro de configuração não se disfarce de escolha. O
`GET /admin/sheets/health` aponta exatamente **quais variáveis** faltam (nomes,
nunca valores).

### Ordem de criação da linha (contrato)

Ao criar uma linha nova, a sequência é fixa e cada passo depende do anterior:

1. **Garantir capacidade** — `appendDimension` com exatamente as linhas que
   faltam. Escrever valor em linha que não existe na grade é erro de range no
   Sheets, então nada pode vir antes disto.
2. **Reservar** — grava só o UUID em CP.
3. **Registrar** o `row_number` no banco, já com a reserva aceita.
4. **Copiar o modelo** — formatação, validações e fórmulas da linha anterior.
5. **Gravar** as células de entrada.

Sobre o passo 4: são **duas requisições separadas e ambas obrigatórias**.
A documentação oficial define `PASTE_FORMAT` como *"Paste the format only,
**excluding** data validation"* — ele não traz as listas suspensas. Por isso
existe um `PASTE_DATA_VALIDATION` à parte; sem ele a linha nova nasceria sem os
dropdowns de grupo, setor, marca e % de desconto.

### Como a linha é reservada (garantia real)

Ao criar uma linha nova, a **primeira** escrita na planilha é só o UUID em CP.
A partir daí a linha é inequivocamente daquele produto: a busca por linha livre
exige NOME (E) **e** ID (CP) vazios, então nenhum outro cadastro a toma, e uma
nova tentativa a reencontra pelo próprio CP — mesmo que a formatação ou a
escrita das demais colunas tenha falhado no meio.

O `row_number` só vai para o banco **depois** que a planilha aceitou a reserva.
Se a própria reserva falhar, nada foi escrito e o banco não guarda linha nenhuma
— a tentativa seguinte escolhe uma linha livre do zero. Em nenhum caminho a
planilha é consultada pelo `row_number` salvo: a busca é sempre pelo UUID.

## Exclusão espelhada

Excluir um produto no sistema **apaga o produto da planilha**. A linha é
localizada pelo UUID na coluna ID (nunca pelo `row_number` salvo) e o sistema
**limpa as colunas de entrada** dela — as mesmas colunas que a escrita preenche.

**Por que limpar em vez de excluir a linha (`deleteDimension`):** excluir a
linha desloca para cima tudo o que está abaixo. A planilha tem fórmulas com
referência absoluta e as abas de loja apontam para linhas fixas — o
deslocamento quebraria essas referências. Limpando, a grade não se mexe.

**Por que só as colunas de entrada e não a linha inteira:** as fórmulas
precisam ficar. A linha `FORMULA_TEMPLATE_ROW` (12) é a linha-modelo de onde
toda sincronização futura copia as fórmulas; se o produto que estivesse nela
fosse excluído e a linha inteira fosse limpa, o modelo seria destruído e
**todas** as sincronizações seguintes passariam a falhar com "Linha-modelo 12
incompleta".

**A linha volta a ser reutilizável de graça:** `primeiraLinhaLivre` procura a
primeira linha com NOME (E) e ID vazios, e as duas são colunas de entrada. O
próximo cadastro ocupa o buraco sozinho, sem código extra.

**A ordem é o inverso da criação — e de propósito.** Na criação, o produto é
gravado no Postgres primeiro e uma falha do Google nunca desfaz o cadastro. Na
exclusão, a planilha vem **primeiro**: se o Google falhar, nada é excluído e a
API responde `502 SHEET_DELETE_FAILED` com o produto intacto nos dois lados.
Isso pode porque exclusão é sempre repetível — basta tentar de novo. Se o
Postgres falhar depois da linha já limpa, o sistema reescreve a linha antes de
propagar o erro, para os dois lados não divergirem.

| Resultado | Significado | Exclusão prossegue? |
|---|---|---|
| `removed` | linha encontrada e liberada | sim |
| `absent` | o produto não estava na planilha | sim (nada a fazer) |
| `skipped` | produto de loja (TNP/LI/HORA), fora do espelhamento | sim |
| `disabled` | `GOOGLE_SHEETS_ENABLED=false` | sim |
| `misconfigured` | ligada, mas sem destino configurado | **não** — 502 |
| `failed` | o Google recusou ou caiu | **não** — 502 |

## Por que as lojas ainda NÃO são espelhadas

Não é falta de código: as abas de loja **não têm a estrutura** para receber o
espelhamento. Verificado na planilha real em 25/08/2026 (leitura, nada escrito),
e reproduzível a qualquer momento por `GET /admin/sheets/health`, que agora
diagnostica TODAS as abas de cadastro:

| Aba | Cabeçalhos | ID | FOTO | Pronta? |
|---|---|---|---|---|
| `(BASE) CADASTRO PRODUTOS` | 74 | CP | CO | **sim** |
| `(TNP) CADASTRO PRODUTOS` | 70 | — | CK | não |
| `(LI) CADASTRO PRODUTOS` | 68 | — | — | não |
| `(HORA) CADASTRO PRODUTOS` | 68 | — | — | não |

As abas de loja não são "a BASE deslocada" — são **outro esquema**:

- **não têm coluna ID.** É por ela que a sincronização acha a linha do produto
  (nunca pelo `row_number` salvo, porque a planilha é editada por gente). Sem
  ID não há idempotência, nem edição, nem exclusão confiáveis;
- **não têm NOME, QUANTIDADE nem MEDIDA BASE como colunas próprias** — só as
  descrições concatenadas. O mapper não teria onde escrever a identidade do
  produto;
- **cada uma tem um layout diferente** (97, 87 e 87 colunas; TNP tem FOTO e
  HABILITAR AJUDA, LI e HORA não têm nenhuma das duas).

Apontar o mapa de colunas da BASE para essas abas escreveria cada dado na coluna
errada, em uma planilha de produção com ~9.930 linhas. Por isso a escrita por
loja **não foi implementada** — seria um espelhamento que corrompe.

**O que destrava:** alinhar as abas de loja à estrutura da BASE (no mínimo:
coluna ID, NOME em E e CODIGO INT. em AC). Quando `pronta` virar `sim` no
health, o espelhamento por loja passa a ser uma mudança contida — o resto do
mecanismo (fila, reserva de linha por UUID, cópia de formato/validação/fórmula,
limpeza na exclusão) já é o mesmo.

**Chave do `product_sheet_sync`:** ao contrário do que se supôs antes, ela NÃO
precisa mudar. Cada produto de loja é uma linha própria em `products`, com id
próprio, e ocupa uma única linha em uma única aba — a chave por produto continua
correta.

## O que esta etapa NÃO faz (fora de escopo)

- não sincroniza as lojas TNP/LI/HORA (ver "Por que as lojas ainda NÃO são espelhadas" acima — é bloqueio de estrutura da planilha, não de código);
- não lê da planilha para o banco;
- não é bidirecional.

---

## 1. Arquivos alterados

### Novos — módulo isolado

| Arquivo | Papel |
|---|---|
| `stack/api/src/modules/google-sheets/google-sheets.client.ts` | Cliente `googleapis` com conta de serviço (JWT) + interface `SheetsGateway` (a costura de teste) e utilitários de notação A1 |
| `stack/api/src/modules/google-sheets/google-sheets.di.ts` | Token `SHEETS_GATEWAY` no tsyringe |
| `stack/api/src/modules/google-sheets/product-sheet.mapper.ts` | Mapeamento inverso do importador: produto → células |
| `stack/api/src/modules/google-sheets/product-sheet.repository.ts` | Acesso a `product_sheet_sync` (aceita `tx`) |
| `stack/api/src/modules/google-sheets/product-sheet.service.ts` | Idempotência, preservação da planilha, escrita, health |
| `stack/api/src/modules/google-sheets/product-sheet.controller.ts` | Guarda de admin + respostas |
| `stack/api/src/modules/google-sheets/product-sheet.routes.ts` | `POST /admin/products/:id/sync-sheet`, `GET /admin/sheets/health` |
| `stack/api/src/modules/google-sheets/product-sheet-sync.table.ts` | Tabela Drizzle |
| `stack/api/src/modules/google-sheets/fake-sheets.gateway.ts` | Planilha falsa em memória (só testes) |
| `stack/api/src/modules/google-sheets/product-sheet.mapper.test.ts` | 37 testes de mapeamento |
| `stack/api/src/modules/google-sheets/product-sheet.service.test.ts` | 29 testes com Google mockado |
| `stack/api/src/modules/google-sheets/product-sheet.integration.test.ts` | 10 testes com Postgres real + Google mockado |
| `stack/api/src/config/env.test.ts` | 9 testes da normalização da chave privada |
| `stack/api/vitest.config.ts` | Runner dos testes unitários (`npm test`) |
| `stack/pwa/app/composables/useFlash.ts` | Aviso que sobrevive à navegação |

### Modificados

| Arquivo | Mudança |
|---|---|
| `stack/api/src/config/env.ts` | 6 vars do Google + `envBool` + `normalizePrivateKey` (converte `\n` literal) |
| `stack/api/src/db/databases.ts` | Registra `productSheetSync` no schema |
| `stack/api/src/modules/product/product.repository.ts` | `create()` aceita `onCreated(productId, tx)` — roda **dentro** da transação. Continua sem nenhuma chamada ao Google |
| `stack/api/src/modules/product/product.service.ts` | Registra `pending` na transação e aciona o espelhamento **depois** do commit |
| `stack/api/src/modules/product/product.controller.ts` | Mensagem conforme o resultado + `details.sheetSync` |
| `stack/api/src/server.ts` | Registra `productSheetRoutes` |
| `stack/api/package.json` | `googleapis@^144.0.0` + script `test` |
| `stack/api/.env.example`, `docker-compose.coolify.yaml`, `.gitignore` | Vars novas; ignora JSON de credencial |
| `stack/pwa/app/composables/useApi.ts` | `createProduct` devolve o envelope (para ler `details.sheetSync`) |
| `stack/pwa/app/components/ProductForm.vue` | Define a mensagem pós-salvar |
| `stack/pwa/app/pages/index.vue` | Snackbar do aviso |
| `stack/api/src/modules/product/product.governance.integration.test.ts` | `ProductService` agora recebe o serviço de planilha (Google mockado) |

---

## 2. Migration criada

`stack/api/drizzle/0003_graceful_morgan_stark.sql`

```sql
CREATE TABLE "product_sheet_sync" (
    "product_id" text PRIMARY KEY NOT NULL,
    "spreadsheet_id" text NOT NULL,
    "sheet_name" text NOT NULL,
    "row_number" integer,
    "status" text DEFAULT 'pending' NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" text,
    "synced_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "product_sheet_sync" ADD CONSTRAINT "product_sheet_sync_product_id_products_id_fk"
  FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade;
```

> **Atenção:** o `start:prod` usa `drizzle-kit push --force`, não `migrate`. Em
> produção a tabela é criada pelo `push` no próximo deploy; a migration serve ao
> histórico e aos testes de integração. Nada destrutivo — só um `CREATE TABLE`.

---

## 3. Variáveis no Coolify

Já declaradas em `docker-compose.coolify.yaml` (serviço `api`). No painel:

| Variável | Valor |
|---|---|
| `GOOGLE_SHEETS_ENABLED` | `false` no primeiro deploy; `true` só depois do health OK |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | **obrigatória, sem padrão no código.** Homologação: ID da cópia. Produção: ID da oficial, só na etapa aprovada |
| `GOOGLE_SHEETS_BASE_TAB` | `(BASE) CADASTRO PRODUTOS` |
| `GOOGLE_SHEETS_DEFAULT_LOJAS` | `TNP,LI,HORA` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | e-mail da conta de serviço (item 5) |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | a chave privada inteira |

Sobre a chave privada: cole **em uma linha só**, com os `\n` literais, exatamente
como vem no JSON (`-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n`).
A API converte essas sequências em quebras reais, e também aceita a chave já
quebrada em várias linhas, com CRLF ou entre aspas — em qualquer um dos formatos
o resultado é o mesmo PEM. Não comitar o JSON — o `.gitignore` já bloqueia
`*service-account*.json`, `gcp-*.json` e `google-credentials*.json`.

---

## 4. Como criar a conta de serviço

1. [console.cloud.google.com](https://console.cloud.google.com) → criar/escolher um
   projeto (ex.: `pralis-sheets`).
2. **APIs e serviços → Biblioteca** → habilitar **Google Sheets API**.
   (Só Sheets. Drive API não é necessária.)
3. **APIs e serviços → Credenciais → Criar credenciais → Conta de serviço**.
   Nome: `pralis-api`. Não é preciso conceder papel algum no projeto — o acesso
   vem do compartilhamento da planilha.
4. Abrir a conta criada → aba **Chaves** → **Adicionar chave → Criar chave nova → JSON**.
   O download é a única cópia; guarde no gerenciador de senhas.
5. Do JSON, use dois campos:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
6. Compartilhar a planilha com esse e-mail (item 5).
7. Deploy com `GOOGLE_SHEETS_ENABLED=false`, conferir `GET /admin/sheets/health`,
   e só então ligar.

---

## 5. E-mail que precisa de acesso de Editor na planilha

O e-mail é **gerado no passo 4** e tem este formato:

```
pralis-api@<id-do-projeto>.iam.gserviceaccount.com
```

O valor exato é o campo `client_email` do JSON baixado — o mesmo que vai em
`GOOGLE_SERVICE_ACCOUNT_EMAIL`. Não existe ainda; só depois de criar a conta.

Na planilha **CENTRAL PRODUTOS (BASE)** → **Compartilhar** → colar esse e-mail →
permissão **Editor** → desmarcar "Notificar pessoas" → Enviar.

Sem isso o health devolve erro de permissão (403) e nada é gravado.

---

## 6. Teste manual sem apagar dados

A planilha só recebe **linhas novas abaixo do último produto** (hoje a linha 160
é a última preenchida; a próxima gravação vai para a 161). Nada existente é
sobrescrito, exceto a linha de um produto que já tenha o UUID em CP.

1. **Antes de tudo:** `Arquivo → Fazer uma cópia` da planilha. Guarde a cópia.
2. Deploy com `GOOGLE_SHEETS_ENABLED=false`.
3. Logado como admin, chamar `GET /admin/sheets/health`. Esperado:
   ```json
   { "enabled": false, "erro": "GOOGLE_SHEETS_ENABLED=false" }
   ```
4. Ligar `GOOGLE_SHEETS_ENABLED=true`, redeploy, chamar o health de novo.
   Esperado `ok: true`, `abaEncontrada: true`, `sheetId` numérico e os três
   cabeçalhos com `ok: true`. Esta rota **não escreve nada**.
5. Cadastrar **um** produto de teste com nome fácil de achar
   (ex.: `ZZ TESTE SHEETS 001`). A tela deve dizer
   "Produto salvo no banco e na planilha".
6. Na planilha, ir para a última linha e conferir:
   - E = o nome; CP = o UUID do produto;
   - AC = o código interno (00042, por exemplo);
   - Q/S = `SIM`/`NÃO` conforme revenda ou transformação; AB = o status;
     BK = `DE:`, BM = `ATÉ:`, BP = `NÃO REVISADO`;
   - as colunas calculadas (H, P, AD, AO, AP, AV, BR) **têm fórmula** e
     calcularam sozinhas — compare com a linha de cima;
   - formatação e listas de validação iguais às da linha anterior (clique numa
     célula de grupo/setor/marca e confirme que a seta da lista aparece);
   - **nenhum** valor da linha-modelo foi copiado (nome, código de barras, ID).
   Se o produto tiver promoção, conferir também:
   - AZ **negativo** (`-20,00%` para 20% de desconto) e AY = preço com desconto;
   - BB:BH com o **rótulo** do dia (`SEG`, `DOM`…) só nos dias ativos, o resto
     vazio; AU = `SIM`.
7. **Testar idempotência:** `POST /admin/products/<id>/sync-sheet` no mesmo produto.
   Deve responder `status: "synced"` com o **mesmo** `rowNumber` e **não** criar
   linha nova.
8. **Testar recuperação:** tirar temporariamente o acesso de Editor da conta de
   serviço, cadastrar `ZZ TESTE SHEETS 002`. A tela deve dizer "Produto salvo no
   banco. Sincronização com a planilha pendente" e o produto tem de aparecer na
   listagem. Devolver o acesso e chamar `POST /admin/products/<id>/sync-sheet` —
   deve virar `synced`.
9. Consulta do estado:
   ```sql
   SELECT p.nome, s.status, s.row_number, s.attempts, s.last_error
   FROM product_sheet_sync s JOIN products p ON p.id = s.product_id
   ORDER BY s.updated_at DESC LIMIT 20;
   ```
10. **Limpeza:** apagar os produtos de teste pelo sistema (o registro de
    sincronização cai por cascade) e, na planilha, **limpar o conteúdo** das
    linhas de teste — nunca "excluir linha", para não deslocar as referências.

Nenhum teste automatizado toca na planilha real: o cliente do Google é
substituído por `FakeSheetsGateway`.

---

## 7. Riscos e decisões pendentes

### Resolvidas na fase 01, com evidência na planilha

1. **Colunas auxiliares — agora preenchidas.** Verificadas nas 150 linhas da aba
   BASE e escritas pelo mapper:
   - **Q** = `SIM` para revenda / `NÃO` para transformação, e **S** o inverso —
     sempre complementares (a fórmula da coluna U depende de `S="SIM"`).
     Observado: 145 linhas `Q=SIM` e 4 `S=SIM`.
   - **AB** = espelho do status (`ATIVO`/`INATIVO`); a coluna AD
     (`IF(AB<>"";P;"")`) só mostra a descrição se AB estiver preenchida.
     Nas 150 linhas AB era igual a C sempre.
   - **AU** = `SIM`/`NÃO` conforme exista promoção; **BP** = `NÃO REVISADO`;
     **BK** = `DE:`; **BM** = `ATÉ:`.
2. **Dias da promoção (BB:BH) — resolvido.** A coluna AP faz
   `HLOOKUP(<rótulo do dia>; $BB$11:$BH$11; 1; 0)`, e o rótulo vem de
   `DATASNUMEROS!AH11:AI17` (1=DOM … 7=SAB). Portanto a célula recebe o
   **próprio rótulo** (`SEG`…`DOM`) quando o dia está ativo e fica **vazia**
   quando não está. O `SIM`/`NÃO` da versão anterior nunca casaria no HLOOKUP —
   a promoção jamais seria aplicada.
3. **Coluna BA (`DESCONTO ATÉ`) — resolvido.** Apesar do formato de percentual,
   a validação de dados aceita só os rótulos da lista `DESCONTOATE`:
   `ATÉ 5%`, `ATÉ 10%`, `ATÉ 20%`, `ATÉ 30%`, `ATÉ 40%`, `ATÉ 50%`. É **texto**,
   gravado com RAW. Nenhuma fórmula usa BA — é informativa.
4. **Coluna AZ (desconto) — corrigido.** Ver "Correção crítica" abaixo.

### Ainda precisam de confirmação sua

5. **Coluna AC (`CODIGO INT.`)** está formatada como `0000` e estava **vazia em
   todas as 150 linhas** da cópia analisada. Gravo o código como **texto**
   (`"00042"`) para não perder o zero à esquerda nem cair para 4 dígitos. Se o
   ERP/PDV espera número, muda a decisão.
6. **Colunas fiscais (BS, BT, BU, BW, BX, CD)** estão formatadas como **texto** e
   também vazias em toda a base. Gravo o número como está no banco, sem
   converter para fração — é o inverso exato do que o importador leu. Quando a
   primeira linha fiscal real existir, revalidar.
7. **Foto (CO).** As linhas existentes têm caminho interno do AppSheet
   (`(BASE) CADASTRO PRODUTOS_Images/5c820a5f.FOTO...`); nós gravamos a URL do
   Cloudinary. Conteúdos diferentes na mesma coluna.

### Correção crítica: sinal do desconto (coluna AZ)

A coluna AY calcula `(AZ*AO)+AO`, ou seja `AO*(1+AZ)`. Um desconto de 20% só
resulta em `0,8×AO` se **AZ for `-0,20`**. A validação de dados confirma: o
intervalo nomeado `PORCENTAGEMDESCONTO` aceita `0`, `-0,01`, `-0,02` … — apenas
zero e negativos.

O banco guarda `descontoPct` como fração **positiva** (0,20), então o mapper
inverte o sinal ao gravar. A versão anterior gravava `+0,20`, o que **aumentava**
o preço em 20% em vez de reduzir. Corrigido e coberto por teste que reproduz a
fórmula da planilha.

Para comparação: a coluna AL (margem) usa o intervalo `PORCENTAGEM`, que aceita
`0`, `0,01`, `0,02` … — **positivos**. Margem positiva, desconto negativo.

### Defeito preexistente na planilha (não corrigido — fora de escopo)

A fórmula da coluna AP referencia `$BB$11:$BH$11` de forma **absoluta**. Ao ser
copiada para qualquer linha, ela continua olhando os dias da **linha 11**, não os
da própria linha. Ou seja, a janela de dias da promoção não funciona por produto
como o resto da fórmula sugere. Não alteramos fórmulas existentes nesta etapa —
vale reportar a quem mantém a planilha.

### Riscos técnicos

7. **Concorrência entre instâncias.** A escolha da primeira linha vazia é
   serializada por uma fila **em processo**. Com duas instâncias da API rodando
   ao mesmo tempo, dois cadastros simultâneos podem disputar a mesma linha. Hoje
   o Coolify roda uma instância. Se isso mudar, é preciso um lock no Postgres
   (`pg_advisory_lock`) antes de escolher a linha.
8. **Edição e exclusão são espelhadas.** Editar reescreve a linha; excluir
   limpa as colunas de entrada e libera a linha (ver "Exclusão espelhada"). A
   exclusão é o único caminho em que uma falha do Google **bloqueia** a operação
   no Postgres — é o que impede os dois lados de divergirem, já que uma exclusão
   pode simplesmente ser repetida.
9. **Produtos cadastrados com a integração desligada** acumulam `status =
   pending` e não têm linha na planilha. Não há endpoint de sincronização em
   lote nesta etapa — é uma chamada de `POST /admin/products/:id/sync-sheet` por
   produto (a query do item 9 lista os pendentes).
10. **Só a primeira promoção** de um produto é espelhada: a planilha tem um único
    bloco de promoção por linha e o banco aceita 0..N.
11. **Evidência de formato veio da cópia local** `tabela/Cópia de CENTRAL
    PRODUTOS (BASE)...xlsx` (150 produtos, linhas 11–160). Se a planilha viva já
    mudou de estrutura, o health e a validação de cabeçalhos avisam antes de
    qualquer escrita — mas os formatos de coluna podem ter mudado sem mexer nos
    cabeçalhos.
12. **`last_error` é sanitizado** (remove blocos `BEGIN PRIVATE KEY`, tokens e
    sequências longas) e truncado em 500 caracteres. Isso pode cortar detalhe
    útil de um erro raro do Google.
13. **Nenhum retry automático.** Uma falha fica `failed` até alguém chamar o
    reprocessamento. Fila/retry com backoff é candidato à etapa 2.
