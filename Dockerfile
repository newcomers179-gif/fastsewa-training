# syntax=docker/dockerfile:1.7
#
# The API image. Three stages, so the image that runs holds only what the API needs:
# the packages listed in server/package.json, the bundled code, the SQL migrations and the
# pre-built admin console. No Expo / React Native toolchain, no compilers, no source.
#
#   docker build -t fastsewa-api --build-arg APP_VERSION=3.0.0 .
#   docker run --env-file .env -p 5000:5000 fastsewa-api
#
# The container applies pending database migrations (docker-entrypoint.sh) and then starts the API.

ARG NODE_VERSION=22

# ── 1. runtime dependencies only ─────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS server-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace=server --ignore-scripts \
 && rm -f node_modules/@fastsewa/server

# ── 2. build the API bundle and the admin console ────────────────────────────
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
COPY tsconfig.json ./
COPY shared ./shared
COPY server ./server
COPY admin ./admin
COPY scripts ./scripts
RUN npm run build

# ── 3. the image that runs ───────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS production
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="FastSewa Training API" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"

# tini forwards SIGTERM to Node and reaps child processes, so `docker stop` and platform
# deploys get the API's graceful shutdown (drain, finish requests, close the database).
RUN apk add --no-cache tini

# --enable-source-maps: error stacks in the logs point at the TypeScript source, not at the bundle.
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    PORT=5000 \
    APP_VERSION=${APP_VERSION} \
    UPLOADS_DIR=/data/uploads

WORKDIR /app
COPY --from=server-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/admin/dist ./admin/dist
COPY migrations ./migrations
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# Local media storage (MEDIA_PROVIDER=local) lives here; mount a persistent volume on it.
RUN chmod +x docker-entrypoint.sh && mkdir -p /data/uploads && chown -R node:node /data

USER node
EXPOSE 5000

# Liveness only (never touches the database): a database outage must not make the orchestrator
# restart healthy API containers. Readiness is GET /api/health/ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
