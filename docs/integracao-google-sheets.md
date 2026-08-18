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

## O que esta etapa NÃO faz (fora de escopo)

- não sincroniza as lojas TNP/LI/HORA;
- não lê da planilha para o banco;
- não espelha **edição** nem **exclusão** (alterar um produto no sistema não
  altera a linha da planilha — só o reprocessamento manual reescreve a linha);
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
| `stack/api/src/modules/google-sheets/product-sheet.mapper.test.ts` | 24 testes de mapeamento |
| `stack/api/src/modules/google-sheets/product-sheet.service.test.ts` | 24 testes com Google mockado |
| `stack/api/src/modules/google-sheets/product-sheet.integration.test.ts` | 9 testes com Postgres real + Google mockado |
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
| `GOOGLE_SHEETS_SPREADSHEET_ID` | `1C0FsFMZelHN1Il3xmoI7E5EStgr_8MpgYz0aJ-X2y2w` |
| `GOOGLE_SHEETS_BASE_TAB` | `(BASE) CADASTRO PRODUTOS` |
| `GOOGLE_SHEETS_DEFAULT_LOJAS` | `TNP,LI,HORA` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | e-mail da conta de serviço (item 5) |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | a chave privada inteira |

Sobre a chave privada: cole **em uma linha só**, com os `\n` literais, exatamente
como vem no JSON (`-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n`).
A API normaliza para quebras reais e também aceita aspas envolventes. Não
comitar o JSON — o `.gitignore` já bloqueia `*service-account*.json`,
`gcp-*.json` e `google-credentials*.json`.

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
   - as colunas calculadas (H, P, AD, AO, AP, AV, BR) **têm fórmula** e
     calcularam sozinhas — compare com a linha de cima;
   - formatação e listas de validação iguais às da linha anterior;
   - **nenhum** valor da linha-modelo foi copiado (nome, código de barras, ID).
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

### Precisam de confirmação sua

1. **Colunas auxiliares fora do mapeamento.** A planilha usa colunas que não
   estavam na especificação e que ficam **em branco** na linha nova:
   - **Q** ("SIM/NÃO" de venda) e **S** ("SIM/NÃO" de transformação) — são
     redundantes com R/T, mas a fórmula da coluna U (`DENTRO DA EMB...`) depende
     de S. Recomendo escrever `Q = SIM / S = NÃO` para revenda e o inverso para
     transformação. Não fiz porque não estava no mapeamento aprovado.
   - **AB** (status do cadastro TNP), **AU** (`PROMOÇÃO SIM/NÃO`),
     **BP** (`NÃO REVISADO`), **BK/BM** (rótulos "DE:"/"ATÉ:").
2. **Coluna AC (`CODIGO INT.`)** está formatada como `0000` e estava **vazia em
   todas as 150 linhas** da cópia analisada. Gravo o código como **texto**
   (`"00042"`) para não perder o zero à esquerda nem cair para 4 dígitos. Se o
   ERP/PDV espera número, muda a decisão.
3. **Coluna BA (`DESCONTO ATÉ`)** tem formato de percentual (`0.00%`), mas no
   banco `descontoAte` é **texto**. Gravo a string com `USER_ENTERED`: "20%"
   vira 0,20 corretamente, mas texto livre vira texto na célula de percentual.
4. **Dias da promoção (BB:BH)** estavam vazios em todas as linhas — não há
   exemplo do formato real. Adotei `SIM`/`NÃO` (convenção do resto da planilha) e
   célula **vazia** quando o produto não tem promoção. Confirmar.
5. **Colunas fiscais (BS, BT, BU, BW, BX, CD)** estão formatadas como **texto** e
   também vazias em toda a base. Gravo o número como está no banco, sem
   converter para fração — é o inverso exato do que o importador leu. Quando a
   primeira linha fiscal real existir, revalidar.
6. **Foto (CO).** As linhas existentes têm caminho interno do AppSheet
   (`(BASE) CADASTRO PRODUTOS_Images/5c820a5f.FOTO...`); nós gravamos a URL do
   Cloudinary. Conteúdos diferentes na mesma coluna.

### Riscos técnicos

7. **Concorrência entre instâncias.** A escolha da primeira linha vazia é
   serializada por uma fila **em processo**. Com duas instâncias da API rodando
   ao mesmo tempo, dois cadastros simultâneos podem disputar a mesma linha. Hoje
   o Coolify roda uma instância. Se isso mudar, é preciso um lock no Postgres
   (`pg_advisory_lock`) antes de escolher a linha.
8. **Edição não é espelhada.** Editar um produto no sistema não atualiza a linha
   da planilha (fora do escopo desta etapa). Até a etapa 2, os dois lados
   divergem depois da primeira edição. O reprocessamento manual reescreve a linha
   com o estado atual do banco.
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
