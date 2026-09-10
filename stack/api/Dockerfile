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

# Carimbo do build. NÃO depende de variável da plataforma — é a única coisa que
# a imagem sabe sobre si mesma com certeza. Existe porque `commit` sozinho
# voltava `null` quando o Coolify não injetava SOURCE_COMMIT, e aí o /health não
# distinguia "deploy novo no ar" de "deploy velho no ar", que é a pergunta que
# se faz depois de todo merge.
RUN date -u +%Y-%m-%dT%H:%M:%SZ > /app/BUILD_TIME

# SHA publicado: chega como build-arg (o compose repassa) ou como variável em
# tempo de execução. O que existir vence, nesta ordem.
ARG SOURCE_COMMIT=""
ENV BUILD_COMMIT=$SOURCE_COMMIT

WORKDIR /app/stack/api
ENV NODE_ENV=production
EXPOSE 3344

# aplica o schema no banco e sobe a API
CMD ["npm", "run", "start:prod"]
