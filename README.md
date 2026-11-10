# Hoist Docs

Hoist framework documentation and API reference for AI coding agents, over MCP. One tool serves
hoist-react, hoist-core and hoist-chat-kit, replacing the stdio MCP servers those libraries used to bundle, with
the same tools: `hoist-search-docs`, `hoist-list-docs`, `hoist-read-doc`, `hoist-search-symbols`,
`hoist-get-symbol`, `hoist-get-members`, `hoist-ping`. Built on the MCP TypeScript SDK v2
(`@modelcontextprotocol/server`): the 2026-07-28 MCP spec, and the 2025 handshake older clients
use.

This repo also holds the builders that make the index files the tool reads, from any release of
each library, and the workflow that publishes them as npm packages. The libraries are listed in
[`src/libraries.ts`](src/libraries.ts). See
[`docs/design.md`](docs/design.md) for the design and [`docs/index-schema.md`](docs/index-schema.md)
for the index format.

## In a Hoist app

Add the tool as a dev dependency of the app's client:

```bash
cd client-app && pnpm add -D @xh/hoist-docs
```

and point the agent at it in `.mcp.json`, at the project root:

```json
{
  "mcpServers": {
    "hoist": {"command": "node", "args": ["client-app/node_modules/@xh/hoist-docs/bin/hoist-docs.mjs"]}
  }
}
```

The agent launches it over stdio. On start it reads the app's installed `@xh/hoist` (and
`@xh/hoist-chat-kit`, if the app uses it) and `hoistCoreVersion` from `gradle.properties`, fetches
the index packages for exactly those versions
through npm (so `.npmrc` registries, proxies and credentials apply), caches them in
`~/.cache/hoist-docs`, and serves them. After a Hoist upgrade, restart the agent. A snapshot
version is served from the `develop` index.

To try it without adding a dependency: `npx @xh/hoist-docs` from the project root.

## Behind an MCP gateway

`hoist-docs --http` serves MCP over Streamable HTTP at `/mcp` (port 8081, or `PORT`). It fetches
each library's index through npm as agents ask for it, using the server's own `.npmrc`: the newest
release by default, or the release an agent names with `library` and `version`. Fetched indexes
are cached in `HOIST_DOCS_CACHE`. Without registry access, give it a directory of index files
instead (`--index-dir`, or `INDEX_DIR`), which may hold several versions of each library.
`GET /health` reports what is loaded. Browser requests are checked against allowed origins
(localhost, plus `ALLOWED_ORIGINS`, comma-separated); agents and gateways send no `Origin` and
pass. The `Dockerfile` runs the same; to serve a directory instead, set `INDEX_DIR` and mount it.

## Docs viewers

`@xh/hoist-docs/docs` is a browser-safe library for docs viewers such as Toolbox's: registry,
content and ranked search, with the same ranking as the MCP tools. Feed it docs payloads written
by:

```bash
hoist-docs export-docs --out <dir>   # <dir>/<library>.json for each library, plus <dir>/index.json

# For doc authors: straight from checkouts, in well under a second, so edits show up live.
hoist-docs export-docs --out <dir> --from-checkout ../hoist-react --from-checkout ../hoist-core
```

```ts
import {DocsCatalog} from '@xh/hoist-docs/docs';
const catalog = new DocsCatalog([reactPayload, corePayload]);
catalog.search('grid column renderer');
```

## Development

Requires Node 24 and pnpm. Node runs the TypeScript source directly; the published package is
compiled (`pnpm build`, run automatically on pack).

```bash
pnpm install
pnpm build:react --root ../hoist-react   # build indexes from sibling checkouts into ./indexes
pnpm build:core --root ../hoist-core
pnpm build:react --root ../hoist-chat-kit --library chat-kit
pnpm dev                                 # HTTP on 8081 from ./indexes, restarting on changes
pnpm mcp --index-dir indexes             # stdio, as an agent would run it
```

Rebuilt or added index files are picked up within a few seconds, without a restart.

- `pnpm test` - unit tests; golden-set retrieval checks for each library (`test/golden/`, `VERBOSE=1` prints every query's top 3); and a parity spec that checks search
  ranks exactly as hoist-react's original search did.
- `HOIST_REACT_ROOT=../hoist-react pnpm test` - also runs the hoist-react builder's schema
  conformance spec against that checkout.
- `pnpm typecheck`, `pnpm lint`, `pnpm format`.

## Building indexes

The builders live in `builders/`: `builders/react/` (Node, ts-morph), for hoist-react and the other
TypeScript libraries, and `builders/core/` (a Java program written in Groovy, built with Gradle;
needs a JDK 17 or later). Each takes a library checkout and writes `<library>-<version>.json` to
`./indexes` (`--out` to change, `--gzip` to compress):

```bash
pnpm build:react --root <hoist-react checkout> [--version 90.0.0]
pnpm build:react --root <hoist-chat-kit checkout> --library chat-kit [--version 1.0.0]
pnpm build:core --root <hoist-core checkout> [--version 44.0.0]
```

To build a release, check the library out at its tag and pass the release `--version`: tagged
commits carry the next snapshot version. A TypeScript library's checkout needs its dependencies
installed first (`corepack pnpm install` or, for hoist-react v86 and earlier,
`corepack yarn install`).

To add a library, add it to `src/libraries.ts`, give it a golden set in `test/golden/`, and set
up a trusted publisher for its index package (see **Publishing**). The library itself needs only
its docs and a `docs/doc-registry.json`.

## Publishing

- **Index packages** (`@xh/hoist-docs-index-react`, `@xh/hoist-docs-index-core`,
  `@xh/hoist-docs-index-chat-kit`): the `Publish indexes` workflow runs daily and on demand,
  publishing every release from each library's floor (hoist-react v83, hoist-core v37,
  hoist-chat-kit v1) that has no index yet, plus `develop`. Locally:
  `pnpm publish:indexes --dry-run [--library react] [--tag v90.0.0] [--repo react=../hoist-react]`
  builds and packs without publishing.
- **The tool** (`@xh/hoist-docs`): push a `vX.Y.Z` tag matching `package.json`; the `Release`
  workflow tests and publishes it.
