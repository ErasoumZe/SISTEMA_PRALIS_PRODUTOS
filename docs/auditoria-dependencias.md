# Auditoria de dependências — Fase 02

> Atualização controlada, uma família por vez, sem `npm audit fix --force` e sem
> misturar mudanças funcionais. Nenhum código de aplicação foi alterado.

## 1. Resultado

| Escopo | Antes | Depois |
|---|---|---|
| **Runtime** (`npm audit --omit=dev`) | 23 — **2 críticas, 11 altas**, 10 moderadas | **8 — 0 crítica, 0 alta**, 4 moderadas* |
| **Total** (com dev) | 35 — **3 críticas, 13 altas**, 19 moderadas | **13 — 0 crítica, 1 alta**, 12 moderadas |

\* O escopo `--omit=dev` do npm ainda conta o build do PWA como runtime, porque
`nuxt` é `dependency` (padrão em projetos Nuxt). Em produção o PWA roda
`.output/server/index.mjs`, que não carrega nuxt/vite/postcss. Ver seção 4.

**Zero vulnerabilidade crítica ou alta com exposição real em runtime.**

## 2. O que foi atualizado, por família

### Família A — Drizzle (API, runtime) · prioridade máxima

| Pacote | Antes | Depois | Advisory |
|---|---|---|---|
| `drizzle-orm` | 0.44.7 | **0.45.2** | **HIGH** — SQL injection via identificadores SQL mal escapados |

Era a de maior risco real: ORM na borda do banco, dependência direta. Sem
alteração de código; typecheck e 92 testes passaram sem ajuste.

### Família B — Fastify (API, runtime)

| Pacote | Antes | Depois | Advisory |
|---|---|---|---|
| `fastify` | 5.8.5 | **5.12.1** | — (traz as transitivas corrigidas) |
| `@fastify/swagger-ui` | 5.2.6 | **6.1.1** | **HIGH** — `@fastify/static` ≤10.1.1: bypass de autorização por path não canônico |
| `@fastify/static` (transitiva) | 9.1.3 | **10.1.3** | idem |
| `find-my-way` (transitiva) | 9.6.0 | **9.8.0** | **HIGH** — DDoS com HTTP/2 |
| `fast-uri` (transitiva) | 3.1.2 | **3.1.5** | **HIGH** — host confusion por barra invertida |
| `@fastify/cookie` / `cors` / `helmet` / `jwt` / `multipart` / `swagger` | — | patches | — |

`@fastify/swagger-ui` 6.x tem **um** breaking change: remoção de
`useUnsafeMarkdown`. Verificado que não é usado — `server.ts` registra só com
`routePrefix: '/docs'`. `find-my-way` e `fast-uri` já eram compatíveis com o
range declarado (`^9.6.0`); estavam presos pelo lockfile, resolvidos com
`npm update`.

### Família C — Vitest + Nuxt (a que travava tudo)

| Pacote | Antes | Depois | Advisory |
|---|---|---|---|
| `vitest` | 2.1.9 | **4.1.11** | **CRÍTICA** — leitura/execução de arquivo arbitrário com a UI ativa |
| `vite` | 5.4.21 | **8.2.1** | **HIGH** — path traversal em `.map` de deps otimizadas |
| `nuxt` | 4.4.8 | **4.5.2** | **HIGH** — OOM não autenticado via `v-for` em island rendering |
| `@nuxt/devtools` (transitiva) | <3.3.1 | **3.4.1** | **CRÍTICA** — RPC não autenticado → execução de comando na máquina do dev |
| `postcss` | 8.5.15 | **8.5.26** | **HIGH** — leitura de `.map` arbitrário via `sourceMappingURL` |
| `svgo` | 4.0.1 | **4.0.2** | **HIGH** — `removeScripts` deixava script executável |
| `tar` | 7.5.16 | **7.5.22** | **CRÍTICA** — crash/DoS no parse |
| `shell-quote` | 1.8.4 | **1.10.0** | **HIGH** — DoS quadrático em `parse()` |
| `brace-expansion` | 2.1.1 | **5.0.9** | **HIGH** — DoS por expansão exponencial |

**Havia uma trava única por trás de quase tudo:** `vitest@2.1.9` fixava
`vite@5`, enquanto o Nuxt 4.5 exige `vite >=6` (o `@nuxt/vite-builder@4.5.2`
pede `^8.2.0`). Subir o Nuxt sozinho produzia árvore inválida e **quebrava o
build do PWA**. Subir o vitest junto resolveu as duas coisas: o vite convergiu
para 8.2.1 e as 3 vulnerabilidades críticas caíram de uma vez.

Vitest 2 → 4 são dois majors, mas **nenhum teste ou config precisou de ajuste**:
os arquivos usam só `defineConfig`, `describe/it/expect`, `beforeAll/afterAll` e
as opções `include`/`exclude`/`testTimeout`/`hookTimeout`/`fileParallelism`,
todas estáveis.

### Família D — googleapis (API, runtime)

| Pacote | Antes | Depois | Advisory |
|---|---|---|---|
| `googleapis` | 144.0.0 | **176.0.0** | MODERADA — `uuid` via `gaxios`/`googleapis-common` |

Salto grande de major. Nosso uso é mínimo (`google.auth.JWT` e
`google.sheets({version:'v4'})`), e foi verificado em runtime: a JWT é
construída com uma chave RSA real e os quatro métodos usados pelo cliente
(`spreadsheets.get`, `spreadsheets.batchUpdate`, `values.batchGet`,
`values.batchUpdate`) continuam existindo. Removeu 4 das 8 moderadas de runtime.

### Família E — Testcontainers (dev)

| Pacote | Antes | Depois | Advisory |
|---|---|---|---|
| `undici` (via `@testcontainers/postgresql`) | 7.28.0 | **7.29.0** | **HIGH** — dessincronização de resposta / vazamento entre usuários |

Só afeta os testes de integração, mas tinha correção disponível.

### Correção de rota — peer perdido

`@zxing/library@0.22.0` foi adicionado como dependência **explícita** do PWA.
Ele é `peerDependency` de `@zxing/browser` (scanner de código de barras) e vinha
sendo auto-instalado. Durante esta fase uma tentativa com `--legacy-peer-deps`
gravou um lockfile sem ele, e o build passou a falhar com
`Rolldown failed to resolve import "@zxing/library"`. Declarar explicitamente
impede que suma de novo em silêncio — o app realmente precisa dele em runtime.

## 3. O que NÃO foi feito, e por quê

**`--legacy-peer-deps` foi descartado.** Ele completou a instalação, mas
produziu árvore com `vite@5.4.21`, `commander@11.1.0` e `esbuild@0.25.12`
marcados como `invalid` — exatamente a "combinação sem suporte" que a fase
proíbe — e **o build do PWA quebrou**. A árvore final foi reconstruída do zero
sem esse sinalizador. `npm ls --all` hoje não aponta nenhuma entrada inválida.

**Nenhum `override` foi aplicado** e **nenhum advisory foi ignorado.**

## 4. Vulnerabilidades restantes e exposição real

### Alta — `xlsx` (sem correção publicada)

| Item | Situação |
|---|---|
| Advisories | Prototype Pollution (GHSA-4r6h-8v6p-xvw6) e ReDoS (GHSA-5pgg-2g8v-p4x9) |
| Correção | **Não existe.** O SheetJS saiu do registro público do npm; a versão corrigida é distribuída fora dele |
| Tipo | `devDependency` de `stack/api` |
| Uso | Só em `src/db/gen-base-json.ts`, executado pelo script manual `npm run gen:base` |
| Entra em produção? | **Não.** Não é importado por `server.ts` nem pela cadeia do `start:prod` |
| Exposição real | Um desenvolvedor rodando `gen:base` sobre uma planilha **local e confiável** (`../tabela/*.xlsx`). Nenhum arquivo de terceiro é processado, e nada disso roda no servidor |

**Mitigação em vigor:** o risco é limitado à máquina do desenvolvedor que rodar
o script, sobre arquivo próprio.

**Decisão humana requerida:** manter como está (recomendado — o script é de uso
raro e o arquivo é confiável), ou migrar `gen-base-json.ts` para uma
alternativa mantida como `exceljs`. Como o `base-products.json` gerado já está
commitado, uma terceira opção é remover a devDependency e só reinstalá-la
quando for preciso regerar.

### Moderadas restantes (4 em runtime, 12 no total)

| Pacote | Cadeia | Exposição real |
|---|---|---|
| `esbuild` | `vuetify-nuxt-module` → `unconfig` → `importx` | O advisory é sobre o **servidor de desenvolvimento** do esbuild aceitar requisições de qualquer site. Não existe em produção: o PWA serve `.output/`, e o dev server só roda em `localhost` durante o desenvolvimento |
| `unconfig`, `importx`, `vuetify-nuxt-module` | mesma cadeia | idem — são as camadas acima do mesmo esbuild |

A correção depende de o `vuetify-nuxt-module` (hoje `0.18.9`, cuja próxima
versão é `1.0.0-rc.4`, ainda release candidate) atualizar sua cadeia. Não subi
para um RC em dependência de build da interface inteira sem sua decisão.

## 5. Comandos e resultados reais

Suíte completa executada após **todas** as mudanças:

| Comando | Diretório | Resultado |
|---|---|---|
| `npm test` | `stack/shared` | ✅ 16 testes |
| `npm run typecheck` | `stack/api` | ✅ exit 0 |
| `npm test` | `stack/api` | ✅ 75 testes |
| `npm run test:integration` | `stack/api` | ✅ 17 testes (Postgres real via Testcontainers) |
| `npm run build` | `stack/pwa` | ✅ Build complete — 1.86 MB (455 kB gzip) |
| `git diff --check` | raiz | ✅ exit 0 |
| `npm ls --all` | raiz | ✅ sem entradas `invalid` |

**108 testes passando.**

Verificações extras, por causa dos majors:

- **API sobe de fato** (os testes não iniciam o servidor): `GET /health` → 200
  `{"ok":true}`; `GET /docs` → 200; `/docs/json` lista 19 rotas, incluindo
  `/admin/products/{id}/sync-sheet` e `/admin/sheets/health`.
- **googleapis 176 compatível**: JWT construída com chave RSA real e os quatro
  métodos usados pelo cliente presentes.
- **Comportamento da integração Sheets preservado**: os 121 testes do módulo
  (mapper, serviço com Google mockado e integração com Postgres) passam sem
  nenhuma alteração.

## 6. Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `stack/api/package.json` | `drizzle-orm` ^0.45.2, `fastify` ^5.12.1, `@fastify/swagger-ui` ^6.1.1, demais `@fastify/*`, `googleapis` ^176.0.0, `vitest` ^4.1.11 |
| `stack/pwa/package.json` | `nuxt` ^4.5.2, `@zxing/library` ^0.22.0 (peer explícito) |
| `stack/shared/package.json` | `vitest` ^4.1.11 |
| `package-lock.json` | árvore reconstruída sem `--legacy-peer-deps` |

Nenhum arquivo de código de aplicação foi tocado nesta fase.

## 6-A. Complemento de 24/08 — `npm ls --all` limpo

`npm ls --all` ainda saía com **exit 1** (`ELSPROBLEMS`):

```
missing: react@^18.0 || ^19.0 || ^19.0.0-rc, required by @react-email/render@1.1.2
missing: react-dom@^18.0 || ^19.0 || ^19.0.0-rc, required by @react-email/render@1.1.2
```

**Cadeia exata:** `@pralis/api` → `resend@4.8.0` → `@react-email/render@1.1.2`,
que declara `react` e `react-dom` como peers **obrigatórios** (sem
`peerDependenciesMeta.optional`). Nosso código nunca importa React: o
`EmailService` usa só `resend.emails.send({ html })`.

**Correção na origem, em dois passos:**

1. **`resend` 4.8.0 → 6.22.0.** A partir da v6 o `@react-email/render` deixou de
   ser dependência e virou **peer opcional** (`peerDependenciesMeta.optional:
   true`). Só duas dependências restam: `postal-mime` e `standardwebhooks`.
   Compatibilidade verificada: `engines: node >=20`; local é v22.23.2 e as duas
   imagens Docker são `node:22-bookworm-slim`. A API que usamos
   (`new Resend(key)` + `emails.send({from,to,subject,html})`) não mudou.
2. **`react` e `react-dom` como devDependencies de `stack/api`.** O npm instala
   peers opcionais por padrão, então o `@react-email/render` continua na árvore
   e exige os peers dele. `npm prune` não remove (não é extraneous) e nenhuma
   versão de `@react-email/render` — até a 2.1.0 — marca os peers de React como
   opcionais, o que descarta a via de `overrides`.

Não foi usado `--legacy-peer-deps`, override incompatível nem `audit fix --force`.

**Resultado:** `npm ls --all` → **exit 0**, árvore sem nenhuma inconsistência.

### Observação sobre a imagem de produção

O `stack/api/Dockerfile` roda `npm ci` **sem** `--omit=dev`, então as
devDependencies (incluindo `vitest`, `@testcontainers/postgresql`, `xlsx` e agora
`react`) vão para a imagem final. **Não é simples corrigir:** o `start:prod`
depende de `drizzle-kit` e `tsx`, que hoje são devDependencies. Para enxugar a
imagem seria preciso antes mover esses dois para `dependencies`. Fica registrado
como melhoria separada — não foi alterado aqui para não mexer no build de deploy.

### Números finais (24/08)

| Escopo | Antes | Depois |
|---|---|---|
| **Runtime** (`--omit=dev`) | 23 (2 críticas, 11 altas, 10 moderadas) | **4 moderadas — 0 críticas, 0 altas** |
| **Completa** (com dev) | 35 (3 críticas, 13 altas, 19 moderadas) | **13 (1 alta, 12 moderadas)** |
| `npm ls --all` | exit 1 (ELSPROBLEMS) | **exit 0** |

A única alta restante é o **`xlsx`**, sem correção publicada, usada apenas pelo
script de desenvolvimento `gen:base` sobre um arquivo local confiável. Não é
alcançável em runtime da API.

## 7. Pendências para decisão

1. **`xlsx`** — manter (recomendado), migrar para `exceljs`, ou remover a
   devDependency e reinstalar sob demanda.
2. **`vuetify-nuxt-module`** — esperar a 1.0 estável ou adotar o RC para
   encerrar a cadeia do esbuild.
3. **Rotina** — vale repetir `npm audit --omit=dev` a cada release; a base
   agora está limpa e desvios ficam visíveis.
