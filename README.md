# Hoist Docs

Hoist application that serves Hoist framework documentation and API reference:

- **`/mcp`** - an MCP server (Streamable HTTP, stateless) for AI coding agents, with the tools
  previously bundled as stdio servers in hoist-react and hoist-core: `hoist-search-docs`,
  `hoist-list-docs`, `hoist-read-doc`, `hoist-search-symbols`, `hoist-get-symbol`,
  `hoist-get-members`, `hoist-ping`. Open to anonymous callers, so it can sit behind an MCP gateway.
- **Docs viewer** - a browser UI for the same content, behind the same Auth0 login as Toolbox.
- **Admin console** - standard Hoist admin, including activity tracking of every MCP call.

See [`docs/design.md`](docs/design.md) for the design and [`docs/index-schema.md`](docs/index-schema.md)
for the index files it serves.

## Running locally

1. Build index files from sibling checkouts and put them in `./indexes`:

   ```bash
   (cd ../hoist-react && pnpm build:index --out ../hoist-docs/indexes)
   (cd ../hoist-core && ./gradlew :docs-index:buildIndex && cp docs-index/build/docs-index/*.json ../hoist-docs/indexes/)
   ```

2. Copy `.env.template` to `.env`. For a throwaway setup set `APP_HOISTDOCS_USE_H2=true` and
   `APP_HOISTDOCS_OAUTH_PROVIDER=NONE` with a bootstrap admin user and password.
3. Start the server with `./gradlew bootRun` (port 8080) and the client with
   `cd client-app && pnpm start` (port 3000).

Point an agent at the server:

```json
{"mcpServers": {"hoist": {"type": "http", "url": "http://localhost:8080/mcp"}}}
```

## Tests

`./gradlew test -PtestIndexDir=indexes` runs the search parity spec, which checks that ranking
matches hoist-react's TypeScript search exactly for every golden-set query. The fixtures in
`src/test/resources/parity` must be regenerated from the same hoist-react commit as the index.
