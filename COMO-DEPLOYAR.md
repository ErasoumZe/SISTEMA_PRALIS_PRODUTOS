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
   | `CLOUDINARY_CLOUD_NAME` `CLOUDINARY_API_KEY` `CLOUDINARY_API_SECRET` | do dashboard do Cloudinary |

4. **Deploy.** O Coolify builda as imagens e sobe os 3 serviços.
5. **Domínios + Cloudflare:** aponte os domínios (front e API) para o servidor, com DNS no
   Cloudflare. Libere os usuários no **Zero Trust → Access → Applications** se usar essa camada.

## Detalhes importantes

- A API roda `start:prod` = aplica o schema (`drizzle-kit push`) e sobe o servidor. Assim o banco
  já nasce com as tabelas.
- Em produção os cookies são **secure** (HTTPS) automaticamente (`NODE_ENV=production`).
- `CORS_ORIGIN` deve ser a URL exata do front (não use `*` com cookies em produção).
- O front lê a API por `NUXT_PUBLIC_API_BASE` (= `API_URL`).

## Simular produção localmente (opcional)
Crie um `.env` ao lado do compose com as variáveis acima e rode:
```bash
cd pralis
docker compose -f docker-compose.coolify.yaml up --build
```
Front em http://localhost:3000, API em http://localhost:3344.

## Merge → deploy automático
Como na Cicluz: configure o Coolify para **redeploy automático no push da branch main**.
Aí cada merge atualiza o app em produção.
