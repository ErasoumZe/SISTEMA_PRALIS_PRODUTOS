# Como rodar o sistema Pralis (local)

O sistema tem 3 partes: **banco (Postgres)** → **API (Fastify)** → **front (Nuxt PWA)**.

## Pré-requisitos
- Node.js 20+ e Docker Desktop (rodando).

## 1. Instalar (uma vez)
```bash
cd pralis
npm install
```

## 2. Subir o banco (Postgres no Docker)
```bash
cd pralis/stack/api
docker compose up -d          # sobe o Postgres na porta 5433 (projeto isolado "pralis")
npm run db:push               # cria as tabelas (só na 1ª vez ou quando o schema mudar)
```

## 3. Subir a API
```bash
cd pralis/stack/api
npx tsx src/server.ts
```
- API em **http://localhost:3344**
- Documentação (Swagger) em **http://localhost:3344/docs** ← dá pra testar tudo por aqui

## 4. Subir o front
Em **outro terminal**:
```bash
cd pralis/stack/pwa
npm run dev
```
- App em **http://localhost:3000** ← abra no navegador

## Pronto!
Abra **http://localhost:3000**. Como o sistema agora tem **login**, na primeira vez clique em
**"Não tem conta? Criar uma"** e registre um usuário. Depois você cai na galeria de produtos e
pode cadastrar/editar pelo formulário (página única) — os dados vão para o Postgres via API.

> **Fotos (Cloudinary):** o upload de foto só funciona depois de preencher `CLOUDINARY_*` no
> `.env` (crie uma conta grátis em cloudinary.com). Sem isso, o resto funciona normalmente.

---

## Parar tudo
- API e front: `Ctrl + C` em cada terminal.
- Banco: `cd pralis/stack/api && docker compose down` (os dados ficam salvos no volume;
  use `docker compose down -v` para apagar os dados também).

## Problemas comuns
- **"address already in use 3344/3000"**: já tem um servidor rodando nessa porta. Feche-o
  (no Windows: `Get-NetTCPConnection -LocalPort 3344 | %{ Stop-Process -Id $_.OwningProcess -Force }`).
- **Front não carrega produtos**: confira se a API está de pé na :3344 (`curl http://localhost:3344/health`).
- **Mudou a porta da API?** ajuste `NUXT_PUBLIC_API_BASE` (ex.: crie `pralis/stack/pwa/.env`
  com `NUXT_PUBLIC_API_BASE=http://localhost:3344`).

## Quando for para produção (online)
Mesmo caminho da Cicluz: Dockerizar api + pwa, subir no **Coolify** (no servidor), banco
Postgres gerenciado, domínio + **Cloudflare**. O `docker-compose.coolify.yaml` da Cicluz é o
modelo. Isso é uma fase à parte — hoje roda 100% local.
