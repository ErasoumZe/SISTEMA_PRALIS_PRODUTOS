# PWA (Nuxt 4) — build a partir da raiz do monorepo (context = pralis/)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY stack/shared/package.json ./stack/shared/
COPY stack/pwa/package.json ./stack/pwa/
RUN npm ci
COPY stack/shared ./stack/shared
COPY stack/pwa ./stack/pwa
WORKDIR /app/stack/pwa
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
COPY --from=build /app/stack/pwa/.output ./.output
ENV NODE_ENV=production
ENV NITRO_PORT=3000
ENV NITRO_HOST=0.0.0.0
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
