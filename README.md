# Hoist Docs

Small, stateless TypeScript service that serves Hoist framework documentation and API reference:

- **`/mcp`** - an MCP server (Streamable HTTP, stateless) for AI coding agents, with the tools
  previously bundled as stdio servers in hoist-react and hoist-core: `hoist-search-docs`,
  `hoist-list-docs`, `hoist-read-doc`, `hoist-search-symbols`, `hoist-get-symbol`,
  `hoist-get-members`, `hoist-ping`. Open to anonymous callers, so it can sit behind an MCP gateway.
- **`docs/*` API** - public, read-only registry, content and search, used by Toolbox's desktop and
  mobile docs viewers.
- **`/health`** - liveness, with the libraries and versions loaded.

See [`docs/design.md`](docs/design.md) for the design and [`docs/index-schema.md`](docs/index-schema.md)
for the index files it serves. The earlier Grails/Hoist version is at the `grails-prototype` tag.

## Running locally

Requires Node 24 and pnpm. Node runs the TypeScript source directly; there is no build step.

1. Install: `pnpm install`
2. Build index files from sibling checkouts into `./indexes`:

   ```bash
   (cd ../hoist-react && pnpm build:index --out ../hoist-docs/indexes)
   (cd ../hoist-core && ./gradlew :docs-index:buildIndex && cp docs-index/build/docs-index/*.json ../hoist-docs/indexes/)
   ```

   Rebuilt or added index files are picked up within a few seconds, without a restart.

3. Start: `pnpm dev` (restarts on source changes) or `pnpm start`. Listens on port 8081, so it runs
   beside a local Toolbox. For Toolbox to use it, set `APP_TOOLBOX_HOIST_DOCS_URL` or the
   `hoistDocsUrl` instance config to `http://localhost:8081` - see Toolbox's `.env.template`.

Point an agent at it:

```json
{"mcpServers": {"hoist": {"type": "http", "url": "http://localhost:8081/mcp"}}}
```

Configuration is by environment variable: `PORT` (default `8081`), `INDEX_DIR` (default
`./indexes`), `LOG_QUERIES` (`true` to include query text in usage logs), `LOG_LEVEL`.

## Development

- `pnpm test` - unit tests against synthetic index files; golden-set retrieval checks for
  hoist-react and hoist-core (`test/golden/`, `VERBOSE=1` prints every query's top 3); and a
  parity spec that checks search ranks exactly as hoist-react's original search did.
- `pnpm typecheck`, `pnpm lint`, `pnpm format`.

## Container

```bash
docker build -t hoist-docs .
docker run -p 8081:8081 -v "$PWD/indexes:/app/indexes:ro" hoist-docs
```
