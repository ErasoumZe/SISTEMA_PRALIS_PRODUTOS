# API (Fastify + Drizzle) — build a partir da raiz do monorepo (context = pralis/)
FROM node:22-bookworm-slim

# build tools para o argon2 (caso não haja prebuild)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# manifestos (cache de deps)
COPY package.json package-lock.json ./
COPY stack/shared/package.json ./stack/shared/
COPY stack/api/package.json ./stack/api/
RUN npm ci

# código
COPY stack/shared ./stack/shared
COPY stack/api ./stack/api
# Fontes da unificação: o carregador lê estes CSVs em tempo de execução, então
# eles precisam existir na imagem. São catálogo de produto, não segredo.
COPY docs/fonte_*.csv ./docs/

WORKDIR /app/stack/api
ENV NODE_ENV=production
EXPOSE 3344

# aplica o schema no banco e sobe a API
CMD ["npm", "run", "start:prod"]
