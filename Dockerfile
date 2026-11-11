# Hoist Docs gateway image, published as ghcr.io/xh/hoist-docs. Node runs the TypeScript source
# directly (type stripping), so there is no build step. Indexes are fetched as agents ask for them,
# from each library's own channel, and cached in /app/cache (mount a volume to keep it across
# restarts):
# - npm libraries (hoist-react, hoist-chat-kit) through `npm pack`, with the registry and
#   credentials of an .npmrc mounted at /home/node/.npmrc.
# - hoist-core from Maven: Maven Central by default, or an organization's mirror through
#   HOIST_DOCS_MAVEN_REPO (and HOIST_DOCS_MAVEN_USER / HOIST_DOCS_MAVEN_PASSWORD).
# Without registry access, set INDEX_DIR=/app/indexes and mount or bake index files there instead
# (COPY indexes/ /app/indexes/).
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
