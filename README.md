# Hoist Docs

Hoist framework documentation and API reference for AI coding agents, replacing the stdio MCP
servers bundled with hoist-react and hoist-core. It serves the same tools (`hoist-search-docs`,
`hoist-list-docs`, `hoist-read-doc`, `hoist-search-symbols`, `hoist-get-symbol`,
`hoist-get-members`, `hoist-ping`) for both libraries from one program, and this repo also holds
the builders that make the index files it reads.

**Where it's going** (see the design doc): a dev dependency of each Hoist app, `@xh/hoist-docs`,
that the agent launches over stdio and that serves the app's own Hoist versions; the same program
over HTTP for organizations with an MCP gateway; and a docs library Toolbox's viewer uses directly.
XH does not host it.

**What runs today:** an HTTP server with:

- **`/mcp`** - the MCP endpoint (Streamable HTTP, stateless).
- **`docs/*` API** - read-only registry, content and search, used by Toolbox's docs viewers until
  they read docs directly.
- **`/health`** - liveness, with the libraries and versions loaded.

See [`docs/design.md`](docs/design.md) for the design and [`docs/index-schema.md`](docs/index-schema.md)
for the index files it serves. The earlier Grails/Hoist version is at the `grails-prototype` tag.

## Running locally

Requires Node 24 and pnpm. Node runs the TypeScript source directly; there is no build step.

1. Install: `pnpm install`
2. Build index files from sibling checkouts into `./indexes`:

   ```bash
   pnpm build:react --root ../hoist-react
   pnpm build:core --root ../hoist-core
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

## Building indexes

The builders live in `builders/`: `builders/react/` (Node, ts-morph) and `builders/core/` (a Java
program written in Groovy, built with Gradle; needs a JDK 17 or later). Each takes a library
checkout and writes `<library>-<version>.json` to `./indexes` (`--out` to change, `--gzip` to
compress):

```bash
pnpm build:react --root <hoist-react checkout> [--version 90.0.0]
pnpm build:core --root <hoist-core checkout> [--version 44.0.0]
```

To build a release, check the library out at its tag and pass the release `--version`: tagged
commits carry the next snapshot version. A hoist-react checkout needs its dependencies installed
first (`corepack pnpm install` or, for v86 and earlier, `corepack yarn install`).

## Development

- `pnpm test` - unit tests against synthetic index files; golden-set retrieval checks for
  hoist-react and hoist-core (`test/golden/`, `VERBOSE=1` prints every query's top 3); and a
  parity spec that checks search ranks exactly as hoist-react's original search did.
- `HOIST_REACT_ROOT=../hoist-react pnpm test` - also runs the hoist-react builder's schema
  conformance spec against that checkout.
- `pnpm typecheck`, `pnpm lint`, `pnpm format`.

## Container

```bash
docker build -t hoist-docs .
docker run -p 8081:8081 -v "$PWD/indexes:/app/indexes:ro" hoist-docs
```
