# Baseline antes das integrações — Fase 00

> Estado verificável do repositório **antes** de qualquer correção da fase 01.
> Nenhum código foi alterado para produzir este documento.

## 1. Commit e branch

| Item | Valor |
|---|---|
| Branch | `main` |
| HEAD | `0060dfd5061280ab95c7301af81ffcbe70c391d4` — "fix import planilha" |
| Anterior | `2d93139` — "docs: adiciona roteiro seguro das integracoes" |
| Relação com o remoto | `main...origin/main` — sem divergência |
| Data da verificação | 18/08/2026 (checagens de Git, segurança, migrações e 4 suítes) e 19/08/2026 (build do PWA) |

## 2. Estado do working tree

```
git status --short
 M docs/prompts/README.md
?? docs/pausa-segura.md
?? docs/prompts/pausa-segura.md
```

| Categoria | Conteúdo | Origem |
|---|---|---|
| **Staged** | vazio | — |
| **Modificado** | `docs/prompts/README.md` (+4 linhas: seção "Utilitário") | **do usuário** — preservado |
| **Não rastreado** | `docs/prompts/pausa-segura.md` | **do usuário** — preservado |
| **Não rastreado** | `docs/pausa-segura.md` | relatório de pausa |
| **Não rastreado** | `docs/baseline-antes-integracoes.md` | este documento |

`git diff --check`: **exit 0**, sem erro de espaço em branco.
`git diff --cached`: **vazio**.

Nenhuma alteração do usuário foi descartada, revertida ou movida para stash.

## 3. Toolchain e comandos corretos

| Ferramenta | Versão |
|---|---|
| Node | v22.23.2 |
| npm | 10.9.8 |
| Workspaces | `stack/shared`, `stack/api`, `stack/pwa` |

| Objetivo | Comando | Diretório |
|---|---|---|
| Instalação | `npm install` | raiz (`pralis/`) |
| Gerar migração | `npm run db:generate` | `stack/api` |
| Aplicar schema (dev) | `npm run db:push` | `stack/api` |
| Subir em produção | `npm run start:prod` | `stack/api` |
| Rodar API (dev) | `npm run start:dev` | `stack/api` |
| Typecheck | `npm run typecheck` | `stack/api` |
| Testes shared | `npm test` | `stack/shared` |
| Testes unitários API | `npm test` | `stack/api` |
| Testes de integração API | `npm run test:integration` | `stack/api` |
| Build do PWA | `npm run build` | `stack/pwa` |
| Rodar PWA (dev) | `npm run dev` | `stack/pwa` |

> **`start:prod` usa `drizzle-kit push --force`, não `migrate`.** Em produção o
> schema é aplicado por *push*; os arquivos em `drizzle/` servem ao histórico e
> aos testes de integração, que usam `migrate()`. São dois caminhos distintos
> para o mesmo schema — vale conferir que continuam equivalentes a cada mudança.

## 4. Resultado real das suítes

Cada linha é resultado observado, não estimativa.

| Suíte | Comando | Diretório | Resultado | Quando |
|---|---|---|---|---|
| Shared | `npm test` | `stack/shared` | ✅ **16 testes / 1 arquivo** — exit 0 | 18/08 ~16:23 |
| Typecheck API | `npm run typecheck` | `stack/api` | ✅ `tsc --noEmit` sem erro — exit 0 | 18/08 ~16:24 |
| Unitários API | `npm test` | `stack/api` | ✅ **48 testes / 2 arquivos** — exit 0 | 18/08 ~16:24 |
| Integração API | `npm run test:integration` | `stack/api` | ✅ **16 testes / 3 arquivos** — exit 0 | 18/08 ~16:25 |
| Build PWA | `npm run build` | `stack/pwa` | ✅ "Build complete", 1.72 MB (412 kB gzip) — exit 0 | 19/08 |

**Total: 80 testes passando, nenhuma falha.**

### Dependências externas das suítes

| Suíte | Depende de |
|---|---|
| Shared, unitários API, typecheck, build PWA | **Nada externo.** Rodam offline. |
| **Integração API** | **Docker em execução.** Usa Testcontainers para subir `postgres:18.1-alpine` efêmero por arquivo de teste, aplica `migrate()` a partir de `stack/api/drizzle` e destrói o container ao final. Sem Docker, a suíte falha no `beforeAll`. Não usa o banco de desenvolvimento nem o de produção. |

Nenhuma suíte acessa a planilha do Google: o cliente real é substituído por
`FakeSheetsGateway` (planilha em memória).

Docker verificado disponível na máquina. Nenhum container Testcontainers ficou
em execução após as suítes. Os containers `postgres:16-alpine` e `redis:alpine`
que estão de pé são **serviços preexistentes do usuário** e não foram tocados.

## 5. Segurança — segredos versionados

| Verificação | Resultado |
|---|---|
| Arquivos `.env` rastreados pelo Git | apenas `stack/api/.env.example` (esperado) |
| `stack/api/.env` está ignorado | sim — `.gitignore:13` |
| JSON de conta de serviço, `.pem`, `.key` rastreados | **nenhum** |
| Padrões `BEGIN PRIVATE KEY`, `ya29.`, `AIza…` no conteúdo versionado | **nenhum** |
| Histórico já conteve `.env` ou conta de serviço | **nunca adicionado** |
| Conteúdo staged com segredo | staging vazio |

**Conclusão: nenhum segredo versionado.**

Ressalva de baixo risco: `stack/api/.env.example` traz `JWT_SECRET` e
`COOKIE_SECRET` com valores de desenvolvimento (`dev-…-troque-em-producao`).
São placeholders propositais, não credenciais reais. Em produção o
`docker-compose.coolify.yaml` injeta `${JWT_SECRET}` e `${COOKIE_SECRET}` do
painel — **confirmar que estão definidos lá**, senão o fallback do `env.ts`
entra em produção.

O `.gitignore` já bloqueia `*service-account*.json`, `gcp-*.json` e
`google-credentials*.json`.

## 6. Consistência das migrações Drizzle

| Verificação | Resultado |
|---|---|
| Arquivos `.sql` | 4 (`0000_unusual_revanche`, `0001_plain_morbius`, `0002_furry_nightmare`, `0003_graceful_morgan_stark`) |
| Entradas no `_journal.json` | 4 |
| Snapshots em `meta/` | 4 |
| `idx` sequencial (0,1,2,3) | ✅ |
| `when` estritamente crescente | ✅ |
| `.sql` sem entrada no journal | nenhum |
| Entrada no journal sem `.sql` | nenhum |
| Snapshot faltando | nenhum |

**Conclusão: migrações e snapshots consistentes e em ordem.** A `0003` cria
`product_sheet_sync` (`CREATE TABLE` + FK com `ON DELETE cascade`) — nada
destrutivo, nenhuma migração parcial.

## 7. Riscos existentes

### Alto — bugs confirmados na integração Sheets (objeto da fase 01)

Levantados ao ler `docs/prompts/fase-01-corrigir-integracao-sheets.md` e
conferidos contra a planilha de referência. **A fase 01 ainda não foi
executada**; nenhuma correção foi aplicada.

| Item da fase 01 | Avaliação com base em evidência |
|---|---|
| **2 — sinal do desconto em AZ** | **Bug real, confirmado.** A fórmula da coluna AY é `(AZ*AO)+AO`, extraída da própria planilha. Para 20% de desconto o preço promocional só sai `0,8×AO` se AZ for `-0,20`. A implementação grava `+0,20`, o que **aumenta** o preço. **Impeditivo para ligar em produção.** |
| **6 — crescimento da grade** | **Bug real, confirmado.** `appendDimension` usa `linha - rowCount + 1`; o correto é `linha - rowCount`. Adiciona uma linha a mais que o necessário. |
| **7 — reserva de linha no retry** | **Documentação imprecisa.** O retry volta à mesma linha porque ela continua vazia, não por causa da reserva em `product_sheet_sync`. Gravar o UUID em CP antes das demais colunas tornaria a garantia real. |
| **5 — colunas Q, S, AB, AU, BP, BK, BM** | Coincide com a pendência nº 1 já registrada em `docs/integracao-google-sheets.md`. Ficaram em branco por fidelidade ao mapeamento aprovado. |
| **3 — dias BB:BH** | **A verificar.** Na cópia analisada, BB:BH estavam vazias nas 150 linhas — não há evidência do formato real. Conferir abas TNP/LI/HORA e as fórmulas que consomem essas colunas antes de trocar `SIM/NÃO` por `SEG…DOM`. |
| **1 — normalização da chave privada** | **A verificar.** A implementação troca `\n` literal por quebra real sem afetar quebras já reais; o que falta é **teste** — hoje não existe nenhum. |
| **4 — `PASTE_FORMAT` e validação de dados** | ~~Contradiz a documentação oficial~~ — **avaliação errada, corrigida em 24/08**. A doc oficial define `PASTE_FORMAT` como *"Paste the format only, **excluding** data validation"*. O apontamento estava certo: `PASTE_DATA_VALIDATION` é **obrigatório**, não redundância. Sem ele a linha nova nasceria sem as listas suspensas. |

### Médio

- **Edição e exclusão não são espelhadas** na planilha nesta etapa: depois da
  primeira edição de um produto, banco e planilha divergem.
- **Fila de linha vazia é em processo**: protege uma única instância da API. Com
  mais de uma instância, dois cadastros simultâneos podem disputar a mesma linha
  — precisaria de `pg_advisory_lock`.
- **Sem retry automático**: uma falha fica `failed` até alguém chamar
  `POST /admin/products/:id/sync-sheet`. Não há endpoint de reprocessamento em
  lote.
- **Produtos criados com a integração desligada** acumulam `status = pending`
  sem linha na planilha.

### Baixo

- 6 decisões de mapeamento seguem pendentes de confirmação do usuário
  (`docs/integracao-google-sheets.md`, seção 7).
- `stack/pwa/.output` e `.nuxt` existem como artefatos de build (gitignored).

### Estado da integração

`GOOGLE_SHEETS_ENABLED` está **`false`**. A planilha real
`1C0FsFMZelHN1Il3xmoI7E5EStgr_8MpgYz0aJ-X2y2w` **nunca foi acessada** por esta
sessão — nenhuma linha criada, alterada ou apagada. Nenhum deploy foi feito.

## 8. Procedimento de rollback

O código da integração está inteiramente no commit `0060dfd`, e o commit
anterior (`2d93139`) é um estado sem a integração.

**Desfazer só a integração, preservando o roteiro de fases:**

```bash
# revert cria um commit novo, sem reescrever histórico
git revert --no-commit 0060dfd
# revisar antes de concluir
git status --short
git diff --cached --stat
```

**Voltar a API ao estado anterior sem mexer no Git** (útil em produção): definir
`GOOGLE_SHEETS_ENABLED=false` no Coolify e reiniciar. A integração fica inerte —
o cadastro continua funcionando normalmente e nada é escrito na planilha. É o
rollback mais rápido e sem risco.

**Sobre o banco:** a migração `0003` só adiciona a tabela `product_sheet_sync`.
Reverter o código **não** exige derrubar a tabela — ela fica órfã e inofensiva.
Se ainda assim for necessário removê-la:

```sql
DROP TABLE IF EXISTS product_sheet_sync;
```

Nenhuma coluna de `products` foi alterada ou removida, então não há perda de
dado de produto em nenhum dos caminhos acima.

**Não fazer:** `git reset --hard`, `git clean` ou checkout destrutivo — há
alterações não rastreadas do usuário em `docs/prompts/`.

## 9. Decisão

Critérios de saída da fase 00:

- [x] Baseline documentado.
- [x] Nenhum segredo versionado.
- [x] Resultado real de todas as suítes relevantes conhecido (5 de 5).
- [x] Migrações e snapshots consistentes — nenhuma migração parcial.

Os bugs da seção 7 **não bloqueiam a fase 00**: são exatamente o que a fase 01
existe para corrigir, e nenhum deles é segredo versionado ou inconsistência de
migração.

## `APROVADO PARA FASE 01`

Entrar na fase 01 por `stack/api/src/modules/google-sheets/product-sheet.mapper.ts`,
campo `AZ` (sinal do desconto). Antes de editar o formato dos dias (item 3),
conferir as abas TNP/LI/HORA da planilha de referência em busca de linhas com
promoção preenchida.
