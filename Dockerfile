# Hoist Docs service image. Node runs the TypeScript source directly (type stripping), so there is
# no build step. Indexes are fetched through npm as agents ask for them, using the registry and
# credentials of an .npmrc mounted at /home/node/.npmrc, and cached in /app/cache (mount a volume to
# keep it across restarts). Without registry access, set INDEX_DIR=/app/indexes and mount or bake
# index files there instead (COPY indexes/ /app/indexes/).
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8081 \
    HOIST_DOCS_CACHE=/app/cache

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune

COPY src ./src
RUN mkdir -p /app/cache && chown node /app/cache

USER node
EXPOSE 8081
CMD ["node", "src/cli.ts", "--http"]
