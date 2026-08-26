# Deploy no Coolify (produção)

Mesmo caminho da Cicluz: **Docker → Coolify**, banco Postgres, domínio + **Cloudflare**.
Os artefatos já estão prontos:

- `stack/api/Dockerfile` — imagem da API (Fastify + Drizzle), aplica o schema e sobe
- `stack/pwa/Dockerfile` — imagem do front (Nuxt build → servidor Nitro)
- `docker-compose.coolify.yaml` — orquestra Postgres + API + PWA
- `.dockerignore` — não envia node_modules, .env, etc.

## Passos no Coolify

1. **Código no GitHub:** já está em https://github.com/ErasoumZe/SISTEMA_PRALIS (branch `main`).
   A raiz do repositório é o monorepo (o `docker-compose.coolify.yaml` está na raiz).
2. No Coolify: **New Resource → Docker Compose**, repositório `SISTEMA_PRALIS`, branch `main`,
   arquivo compose = `docker-compose.coolify.yaml` (na raiz).
3. Configure as **variáveis de ambiente** (painel do Coolify):

   | Variável | Exemplo / observação |
   |----------|----------------------|
   | `DB_USER` `DB_PASSWORD` `DB_NAME` | credenciais do Postgres |
   | `APP_URL` | URL pública do front (ex.: `https://produtos.cicluzieai.com.br`) — vira o CORS |
   | `API_URL` | URL pública da API (ex.: `https://api-produtos.cicluzieai.com.br`) |
   | `JWT_SECRET` `COOKIE_SECRET` | **gere segredos fortes** (ex.: `openssl rand -hex 32`) |
   | `VENDAS_IMPORT_TOKEN` | segredo exclusivo do robô, com pelo menos 32 caracteres |
   | `CLOUDINARY_CLOUD_NAME` `CLOUDINARY_API_KEY` `CLOUDINARY_API_SECRET` | do dashboard do Cloudinary |
   | `GOOGLE_SHEETS_FISCAL_TAB` | `(TNP) FISCAL - DE PARA PRODUTOS` |

4. **Domínios (no Coolify):** atribua um domínio a **cada serviço exposto**:
   - serviço **`pwa`** → o domínio do front (= `APP_URL`)
   - serviço **`api`** → o domínio da API (= `API_URL`)
   O proxy do Coolify roteia por domínio (por isso o compose usa `expose`, sem fixar porta no host —
   **zero risco de conflito com o app da Cicluz**).
5. **Deploy.** O Coolify builda as imagens e sobe os 3 serviços (em containers isolados).
6. **Cloudflare:** aponte os domínios (front e API) para o servidor, com DNS no Cloudflare.
   Libere os usuários no **Zero Trust → Access → Applications** se usar essa camada.

## Não afeta o app da Cicluz
O Pralis sobe como um **recurso novo e isolado** no Coolify: containers próprios
(`pralis_postgres`, `pralis_api`, `pralis_pwa`), **rede e volume próprios** e **banco Postgres
separado**. Não compartilha nada com o app existente da Cicluz. O `name: pralis` no compose
garante que o projeto não colide com outros.

## Detalhes importantes

- A API roda `start:prod` = aplica o schema (`drizzle-kit push`) e sobe o servidor. Assim o banco
  já nasce com as tabelas.
- Em produção os cookies são **secure** (HTTPS) automaticamente (`NODE_ENV=production`).
- `CORS_ORIGIN` deve ser a URL exata do front (não use `*` com cookies em produção).
- O front lê a API por `NUXT_PUBLIC_API_BASE` (= `API_URL`).
- O robô só envia vendas quando `PRALIS_VENDAS_API_URL` e
  `PRALIS_VENDAS_API_TOKEN` estiverem preenchidos no `.env.producao` dele. O
  token deve ser idêntico a `VENDAS_IMPORT_TOKEN`; enquanto estiverem vazios,
  o Google Sheets continua funcionando sozinho.

## Testar localmente
Para desenvolvimento local, use o fluxo do **[COMO-RODAR.md](COMO-RODAR.md)** (Postgres no Docker +
`tsx` na API + `nuxt dev`). O `docker-compose.coolify.yaml` é otimizado para o Coolify (usa `expose`
em vez de publicar portas no host), então não é o ideal para abrir direto no navegador local.

## Merge → deploy automático
Como na Cicluz: configure o Coolify para **redeploy automático no push da branch main**.
Aí cada merge atualiza o app em produção.
