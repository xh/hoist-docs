# Hoist Docs service image. Node runs the TypeScript source directly (type stripping), so there is
# no build step. Index files are read from /app/indexes - bake them in with a derived image
# (COPY indexes/ /app/indexes/) or mount a volume there.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8081 \
    INDEX_DIR=/app/indexes

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune

COPY src ./src

USER node
EXPOSE 8081
CMD ["node", "src/server.ts"]
