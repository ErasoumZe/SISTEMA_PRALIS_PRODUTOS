# Homologação no Google Sheets — Fase 03

## Status: HOMOLOGAÇÃO VALIDADA · PRODUÇÃO BLOQUEADA (ver fechamento no fim do documento)

## ⛔ ACHADO CRÍTICO (24/08): o spreadsheet ID informado NÃO é a planilha de produtos

O ID passado para esta execução — `1Xx9u0byq4pg92bP8zxRkbjpn8y-k4A-q4OeDGukoU3g`
— foi verificado por leitura de metadados no Drive e **não é uma cópia de
homologação da CENTRAL PRODUTOS**:

| Campo | Valor |
|---|---|
| Título | **`CICLUZ GP - LANÇAMENTO (VND/MER/DES/RET)`** |
| Dono | `sistemasredepadarialisboa@gmail.com` — **não é o usuário** |
| Criada / modificada | 04/03/2026 · **modificada em 24/08/2026** (em uso ativo) |
| Tamanho | ~4,98 MB |

É a planilha de **lançamentos** (vendas/mercadorias/despesas/retiradas), de outro
proprietário e em uso corrente. Escrever linhas de produto nela corromperia uma
planilha operacional viva. **Nenhuma escrita foi feita.**

### A planilha correta existe e foi localizada

| Planilha | ID | Dono | Observação |
|---|---|---|---|
| **`HOMOLOGAÇÃO - CENTRAL PRODUTOS (BASE)`** | `1OrJScm9YiRLYgWIoshHDsRVehwwsgsoT1uSrnfod09A` | **`sistema@cicluz.com.br`** | criada em **19/08 17:21**, durante esta série de fases — **é a cópia de homologação** |
| `Cópia de CENTRAL PRODUTOS (BASE) — CICLUZ GESTÃO PROFISSIONAL` | `1aCGwD2JZRg35utHdUJAzzvcoqBShkkpQ0SAu5VVzwqw` | `sistema@cicluz.com.br` | cópia de 17/06; corresponde ao XLSX local analisado |
| `CENTRAL PRODUTOS (BASE) — CICLUZ GESTÃO PROFISSIONAL` | `1C0FsFMZ…X2y2w` | `sistemasredepadarialisboa@gmail.com` | **OFICIAL — não tocar** |

### ✅ Destino confirmado pelo usuário (24/08)

```
HOMOLOGAÇÃO - CENTRAL PRODUTOS (BASE)
1OrJScm9YiRLYgWIoshHDsRVehwwsgsoT1uSrnfod09A
```

Confirmado explicitamente como a planilha de testes. Registrado **apenas** como
destino informado, em `stack/api/.env` (fora do Git). **Não** foi gravado em
código, e por construção não existe mais fallback de planilha em `env.ts` — o
destino continua obrigatório e explícito por ambiente.

O ID que veio errado no prompt (`1Xx9u0by…`, planilha de LANÇAMENTO) foi
descartado e não aparece em lugar nenhum do repositório.

### Permissões verificadas (somente leitura)

- `HOMOLOGAÇÃO - CENTRAL PRODUTOS (BASE)`: só `sistema@cicluz.com.br` (owner).
  **Nenhuma service account compartilhada ainda** — passo pendente.
- `CENTRAL PRODUTOS (BASE)` (oficial): só o proprietário.
  **Nenhuma service account** — como deve ser.

---

## Preparação concluída, aguardando credenciais do Google

Data: 19/08/2026 · branch `main` · HEAD `0060dfd` (sem commit).

A planilha oficial **não foi acessada**. Nenhuma credencial foi inventada.
Nenhuma escrita foi feita em planilha alguma.

---

## 1. Concluído automaticamente

### 1.1 Fallback perigoso eliminado ✅

**O problema:** `stack/api/src/config/env.ts` trazia o ID da planilha **oficial**
como valor padrão. Bastava alguém ligar `GOOGLE_SHEETS_ENABLED=true` sem informar
o ID para a API começar a escrever em produção.

**A correção, em três camadas:**

1. **Sem padrão no código.** `GOOGLE_SHEETS_SPREADSHEET_ID` agora nasce vazio. O
   destino da escrita é sempre decisão explícita de quem configura o ambiente.
2. **Recusa antes de tocar no Google.** Com a integração ligada e sem destino
   configurado, `syncProduct` devolve `misconfigured` e **não faz nenhuma
   chamada** — nem de leitura. O estado é distinto de `disabled` de propósito,
   para erro de configuração não se disfarçar de escolha.
3. **Diagnóstico preciso.** `GET /admin/sheets/health` passa a devolver
   `configOk` e `configFaltando` com os **nomes** das variáveis ausentes (nunca
   valores), sem consultar o Google.

O ID oficial também saiu do `.env.example`, que agora traz o campo vazio e a
explicação. **Nenhuma ocorrência do ID oficial resta em código ou configuração**
— só na documentação histórica.

**Arquivos alterados:**

| Arquivo | Mudança |
|---|---|
| `stack/api/src/config/env.ts` | remove o padrão; adiciona `destinoSheetsFaltando()` e `credenciaisSheetsFaltando()` |
| `stack/api/src/modules/google-sheets/product-sheet.service.ts` | `operacional`, recusa `misconfigured`, health com `configOk`/`configFaltando` |
| `stack/api/src/modules/google-sheets/product-sheet.routes.ts` | schemas do novo estado |
| `stack/api/src/modules/product/product.controller.ts` | `misconfigured` conta como pendente na mensagem ao usuário |
| `stack/pwa/app/composables/useApi.ts`, `ProductForm.vue` | novo estado na interface |
| `stack/api/.env.example` | ID oficial removido |
| `.gitignore` | fecha lacunas: `credentials*.json`, `*.pem`, `*.key` |

**Evidência automatizada** (todos falhariam antes da correção):

- `NÃO existe ID de planilha embutido no código como padrão`
- `spreadsheet ID ausente => configuração recusada`
- `spreadsheet ID só com espaços também é recusado`
- `aba ausente também é recusada`
- `LIGADA sem spreadsheet ID => recusa e NÃO toca no Google` — verifica que as
  quatro categorias de chamada ao gateway ficam em zero
- `LIGADA sem nome de aba => também recusa`
- `health aponta a variável que falta, sem consultar o Google`

### 1.2 Proteção contra segredos ✅

| Padrão | Antes | Agora |
|---|---|---|
| `.env` | ignorado | ignorado |
| `*service-account*.json` | ignorado | ignorado |
| `gcp-*.json` | ignorado | ignorado |
| `credentials*.json` | ❌ **exposto** | ignorado |
| `*.pem` | ❌ **exposto** | ignorado |
| `*.key` | ❌ **exposto** | ignorado |

Nenhum segredo rastreado, nenhum staged. Nenhum arquivo existente foi afetado
pelos novos padrões.

### 1.3 Suíte pré-homologação ✅

| Comando | Diretório | Exit | Testes | Resultado |
|---|---|---|---|---|
| `npm test` | `stack/shared` | 0 | 16 | ✅ |
| `npm run typecheck` | `stack/api` | 0 | — | ✅ |
| `npm test` | `stack/api` | 0 | **84** | ✅ |
| `npm run test:integration` | `stack/api` | 0 | 17 | ✅ |
| `npm run build` | `stack/pwa` | 0 | — | ✅ |
| `git diff --check` | raiz | 0 | — | ✅ |

**117 testes.** Nenhum toca a planilha real — todos usam `FakeSheetsGateway`.

### 1.4 Avaliação de MCP / plugins ✅ — nada a instalar

| Ferramenta | Situação | Decisão |
|---|---|---|
| `claude.ai Google Drive` | conectado, mas **não expõe ferramentas** a esta sessão | inutilizável aqui |
| `playwright` | conectado | **rejeitado** para o Google Cloud: exigiria sua sessão autenticada e faria a **chave privada passar pelo contexto do modelo**. Segredo não deve trafegar por automação de browser |

Nenhum MCP foi instalado. A integração continua usando Google Sheets API +
service account, como deve ser — um MCP não substituiria o código em homologação.

---

## 2. Também já resolvido (não precisa de você)

### Usuário admin — automatizável

`auth.service.ts:32`: quem se registra com o e-mail igual a `ADMIN_EMAIL` recebe
`role: 'admin'` automaticamente. O código de verificação fica no banco
(`users.verification_code`), então o fluxo oficial roda inteiro sem intervenção:

1. `ADMIN_EMAIL=<e-mail de homologação>` no `.env`;
2. `POST /auth/register`;
3. ler o código no banco de homologação;
4. `POST /auth/verify-email` → devolve sessão de admin.

Nenhum passo manual, nenhum provedor de e-mail necessário.

### Banco de homologação — pronto para subir

O projeto já define o Postgres em `stack/api/docker-compose.yml`
(`pralis_pg`, porta **5433**), hoje **parado**.

> O único Postgres em execução na máquina é `padaria-db-dev-db-1` (porta 5543),
> de **outro projeto**. Não foi tocado.

Plano ao retomar, para não misturar dados de teste com o banco de desenvolvimento:

1. subir `pralis_pg` pelo compose do próprio projeto;
2. criar um banco **separado** `pralis_homolog` dentro dele;
3. apontar `DATABASE_URL` para esse banco só durante a homologação;
4. aplicar o schema com `npm run db:push` (script real do projeto).

Deliberadamente **não** subi o container ainda: deixaria um serviço rodando por
tempo indeterminado sem poder concluir a homologação, e a escolha do banco pode
ser sua.

---

## 3. ⛔ Bloqueio: o que só você pode fazer

Só falta o acesso ao Google. Nada além disso.

Ver a seção "AÇÃO MANUAL NECESSÁRIA" na resposta do chat, com o passo a passo.

Resumo do que precisa existir:

| Variável | Origem |
|---|---|
| `GOOGLE_SHEETS_SPREADSHEET_ID` | ID da **cópia** que você já criou |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | campo `client_email` do JSON |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | campo `private_key` do JSON |

Mais a **cópia compartilhada como Editor** com esse e-mail — e a oficial **não**
compartilhada.

---

## 3-B. Gate obrigatório da homologação: a fórmula AP

Na planilha analisada localmente, a coluna **AP** (V. VENDA FINAL) decide se a
promoção vale hoje com:

```
HLOOKUP(<rótulo do dia>; $BB$11:$BH$11; 1; 0)
```

A referência é **absoluta**. Verificado nas 150 linhas: **todas** apontam para
`$BB$11:$BH$11` — uma única faixa, a da linha 11. Ou seja, cada produto avalia os
dias da **linha 11**, não os da própria linha.

**Consequência prática:** gravar os rótulos `SEG…DOM` em BB:BH de uma linha nova
não afeta o AP daquela linha. O mapeamento está correto do nosso lado; o defeito
é da planilha.

**Gate:** na planilha de homologação, antes de validar promoção, conferir se AP
usa a linha do próprio produto (`BB{n}:BH{n}`) ou a absoluta (`$BB$11:$BH$11`).

- Se for relativa → o comportamento é o esperado e a validação de dias vale.
- Se for absoluta → registrar como limitação conhecida e **decidir com o dono da
  planilha**. Não alteramos fórmulas por suposição.

## 4. O que roda sozinho assim que os acessos existirem

1. subir Postgres de homologação e aplicar o schema;
2. criar e verificar o admin pelo fluxo oficial;
3. rodar a suíte completa antes de qualquer chamada externa;
4. `GET /admin/sheets/health` — confirma auth, acesso, aba e cabeçalhos **sem escrever**;
5. registrar o estado inicial da aba (última linha usada) antes da primeira escrita;
6. cadastrar `ZZ HOMOLOG 001` com fiscal, revenda, promoção com desconto, dias e horários;
7. conferir no Postgres (produto + `product_sheet_sync`) e na planilha: linha, UUID em CP,
   **AY calculado de forma independente e comparado**, **AZ negativo**, dias por rótulo,
   horários, e Q/S/AB/AU/BK/BM/BP;
8. validar fórmulas, dropdowns e formatação pela API de metadados;
9. idempotência: `POST /admin/products/:id/sync-sheet` sem criar segunda linha;
10. falha controlada + retry (`failed` → `synced`, sem duplicar);
11. concorrência: `ZZ HOMOLOG PAR 001` e `002` em linhas distintas;
12. limpar **apenas** os dados de teste (conteúdo, nunca excluir linha);
13. suíte final + `git status` + verificação de que nenhum segredo entrou no Git.

---

## 5. Dados de teste remanescentes

**Nenhum.** Nada foi criado em planilha, banco ou serviço externo.

---

# Fechamento da homologação e preflight de produção — 24/08/2026

Branch `fix/sheets-homologacao` · commit da correção final **`3c90d8a`**
(`fix(sheets): repara formulas usando modelo validado`).
**Sem push, merge ou deploy.**

## 1. Correção final: linha-modelo e AP

O canário revelou que a linha **161** da cópia de homologação estava incompleta.
O código antigo copiava as fórmulas da linha imediatamente anterior, então a
linha 162 — criada pelo sistema — nasceu com **AO, AP e AY vazias**.

Correção em três partes:

1. `copiarEstrutura` trata só **formato e validação de dados**, ainda vindos da
   linha anterior (as duas colagens seguem separadas e obrigatórias).
2. `garantirFormulas` usa a **linha 12** como modelo validado e copia apenas as
   colunas cuja fórmula está **ausente no destino**. Roda também em retry, o que
   repara linha reservada por sincronização interrompida sem criar outra.
3. Se a própria linha-modelo estiver incompleta, a operação **falha antes de
   gravar qualquer célula do produto**, em vez de propagar o defeito.

Além disso, **AP passa a consultar os dias da própria linha**. A fórmula
histórica fixa `$BB$11:$BH$11`, de modo que todo produto avaliava os dias do
primeiro. O ajuste vale **apenas para a linha que o sistema criou**; nenhuma
outra linha é alterada.

## 2. Testes (evidência real desta execução)

| Comando | Diretório | Exit | Resultado |
|---|---|---|---|
| `npm test` | `stack/shared` | 0 | 16 |
| `npm run typecheck` | `stack/api` | 0 | limpo |
| `npm test` | `stack/api` | 0 | **89** |
| `npm run test:integration` | `stack/api` | 0 | 17 (Docker ativo) |
| `npm run build` | `stack/pwa` | 0 | Build complete |
| `npm ls --all` | raiz | 0 | árvore limpa |
| `git diff --check` | raiz | 0 | limpo |

Varredura de segredos nos 4 arquivos commitados: as ocorrências de
`BEGIN PRIVATE KEY` são **fixtures sintéticas** dos testes de sanitização —
corpos de 8 a 14 caracteres (uma chave real tem ~1700). Nenhum ID de planilha
em código.

## 3. HOMOLOGAÇÃO — validada

Planilha `HOMOLOGAÇÃO - CENTRAL PRODUTOS (BASE)`, aba `(BASE) CADASTRO PRODUTOS`.

| Item | Valor |
|---|---|
| `sheetId` / `rowCount` / `columnCount` | 653117149 / 9930 / 101 |
| Cabeçalho E5 | `NOME` |
| Linhas com UUID em CP | 151 |
| Última linha usada | 162 |
| Canário | `ZZ HOMOLOG SHEETS 20260824`, linha **162** |
| UUID | `01a0346f-34fd-7d72-b8a1-a4169c0ad0dd` (uma única ocorrência em CP) |
| Preço / desconto / promocional | 15,00 · 20% · **12,00** |
| Validações de dados na linha | 36 |

### Escritas externas realizadas em homologação

1. Linha **162** criada pelo sistema (o canário).
2. Faixa auxiliar `AH11:AI17` da aba `(TNP/LI/HORA - EXP.) DATAS/NUMEROS - VLD
   SAIDA` estava **vazia** e foi preenchida com `1..7` / `DOM..SAB`, após
   conferência contra o XLSX local.

Ambas **apenas na cópia de homologação**. A planilha oficial não foi tocada.

## 4. PRODUÇÃO — preflight somente leitura

| # | Gate | Resultado |
|---|---|---|
| 1 | Service account autentica e acessa a oficial | **FALHOU** — `The caller does not have permission` |
| 2 | Título esperado | não avaliável |
| 3 | Aba `(BASE) CADASTRO PRODUTOS` | não avaliável |
| 4 | Cabeçalhos E5/AC5/CP5 | não avaliável |
| 5 | `sheetId`/`rowCount`/`columnCount` | não avaliável |
| 6 | Linha 12 com as 17 fórmulas obrigatórias | não avaliável |
| 7 | Fórmula AP atual da oficial | não avaliável |
| 8 | `AH11:AI17` com 1=DOM … 7=SAB | não avaliável |
| 9 | Abas auxiliares e faixas não vazias | não avaliável |
| 10 | Validações na linha anterior à primeira livre | não avaliável |
| 11 | Canário de homologação ausente da oficial | não avaliável |

**A credencial não é o problema.** A mesma service account autentica e lê a
planilha de homologação normalmente (17 abas). A falha é **exclusivamente falta
de compartilhamento** na oficial.

### Correção mínima (não executada)

A planilha oficial pertence a **`sistemasredepadarialisboa@gmail.com`**, não à
conta `sistema@cicluz.com.br`. Alguém com permissão de compartilhar precisa
conceder **Editor** à service account do projeto `pralis-sheets-integracao`.
Só depois disso os gates 2 a 11 podem ser avaliados.

Nenhuma alteração foi feita na planilha oficial. Nenhum gate foi contornado.

## 5. Estado da tabela auxiliar de dias

| Ambiente | Estado |
|---|---|
| Homologação | estava **vazia**; preenchida com 1..7 / DOM..SAB |
| Produção | **desconhecido** — depende do gate 1 |

Isto é um risco material: se `AH11:AI17` estiver vazia também na oficial, o
`HLOOKUP` de AP não encontra o rótulo do dia e **a promoção não é aplicada**,
mesmo com os dias gravados corretamente. Precisa ser verificado antes do canário
de produção.

## 6. Riscos e rollback

**Riscos**

1. `AH11:AI17` possivelmente vazia na oficial (acima).
2. AP das linhas **existentes** na oficial segue com `$BB$11:$BH$11`. A correção
   vale só para linhas novas; as antigas continuam avaliando os dias da linha 11.
   Corrigir em massa é decisão do dono da planilha.
3. A linha imediatamente anterior à primeira livre pode estar incompleta na
   oficial, como a 161 estava em homologação. O formato/validação vêm dela.
4. Fila de escolha de linha é **em processo** — vale para uma instância da API.

**Rollback operacional**

1. Desligar `GOOGLE_SHEETS_ENABLED`. O cadastro continua funcionando.
2. Produto permanece no PostgreSQL — é a fonte de verdade.
3. Registros `pending`/`failed` são preservados para retry posterior.
4. **Nenhuma linha oficial é apagada automaticamente.**

## 7. Próximos passos — CREARE

Nada implementado nesta execução. A especificação e a lista de descoberta
obrigatória estão em `docs/plano-pralis-sheets-creare.md`, §8. O CREARE
permanece um destino **independente**: lê do PostgreSQL, nunca do Sheets.
