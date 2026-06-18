# Pralis — Sistema de Cadastro de Produtos

Sistema completo de cadastro de produtos da padaria **Pralis**, no mesmo stack seguro da Cicluz.

## Stack
- **API** — Fastify + TypeScript + Drizzle ORM (PostgreSQL) + Zod + Swagger + **JWT/cookie + argon2** (auth) + **Cloudinary** (fotos)
- **Front (PWA)** — Nuxt 4 + Vue 3 + Vuetify
- **Compartilhado** — `stack/shared`: contratos Zod **e** regras de negócio (usados pela API e pelo front)
- **Testes** — Vitest (unit das regras + integração com Testcontainers/Postgres)
- **Deploy** — Docker + Coolify

## Estrutura
```
pralis/
├─ stack/
│  ├─ shared/   # contratos Zod + regras de negócio (fonte única)
│  ├─ api/      # Fastify + Drizzle (módulos: auth, product, file)
│  └─ pwa/      # Nuxt 4 + Vuetify
├─ docker-compose.coolify.yaml   # deploy (Postgres + API + PWA)
├─ COMO-RODAR.md                 # rodar local
└─ COMO-DEPLOYAR.md              # deploy no Coolify
```

## Funcionalidades
- 🔐 Login / registro (sessão por cookie httpOnly; rotas protegidas)
- 📦 CRUD de produtos com **dados por loja**, **transformação**, **promoção** e **fiscal**
- 🧮 Regras de negócio (descrição, preço, validação, promoção por dia/horário) — testadas
- 📸 Foto do produto via Cloudinary
- 📖 Swagger automático em `/docs`

## Rodar
Veja **[COMO-RODAR.md](COMO-RODAR.md)** (local) e **[COMO-DEPLOYAR.md](COMO-DEPLOYAR.md)** (produção).
