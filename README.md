# Hoist Docs

Hoist framework documentation and API reference for AI coding agents, over MCP. One tool serves
hoist-react, hoist-core and hoist-chat-kit, replacing the stdio MCP servers those libraries used to bundle, with
the same tools: `hoist-search-docs`, `hoist-list-docs`, `hoist-read-doc`, `hoist-search-symbols`,
`hoist-get-symbol`, `hoist-get-members`, `hoist-ping`. Built on the MCP TypeScript SDK v2
(`@modelcontextprotocol/server`): the 2026-07-28 MCP spec, and the 2025 handshake older clients
use.

This repo also holds the builders that make the index files the tool reads. Each library runs
the builder in its own publish job and ships its index the way it ships itself: inside its npm
package for hoist-react and the other TypeScript libraries, and as a `docs-index` Maven artifact
beside the jar for hoist-core. XH's libraries are listed in [`src/libraries.ts`](src/libraries.ts).
See [`docs/design.md`](docs/design.md) for the design and
[`docs/index-schema.md`](docs/index-schema.md) for the index format.

## In a Hoist app

Add the tool as a dev dependency of the app's client:

```bash
cd client-app && pnpm add -D @xh/hoist-docs
```

and point the agent at it in `.mcp.json`, at the project root:

```json
{
  "mcpServers": {
    "hoist-docs": {"command": "node", "args": ["client-app/node_modules/@xh/hoist-docs/bin/hoist-docs.mjs"]}
  }
}
```

The agent launches it over stdio. On start it:

- reads the index inside each installed package that declares one (`hoistDocs` in its
  `package.json`): `@xh/hoist`, `@xh/hoist-chat-kit` if the app uses it, and any other library
  that ships an index;
- fetches hoist-core's index for `hoistCoreVersion` in `gradle.properties` from Maven - Maven
  Central for releases, Sonatype's snapshot repository for snapshots, or an organization's mirror
  (`HOIST_DOCS_MAVEN_REPO`, `HOIST_DOCS_MAVEN_SNAPSHOT_REPO`, with `HOIST_DOCS_MAVEN_USER` and
  `HOIST_DOCS_MAVEN_PASSWORD` if needed) - and caches it in
  `~/.cache/hoist-docs`;
- serves them.

Every index is exactly the installed build, snapshots included. After a Hoist upgrade, restart the
agent.

The Maven fetch is the tool's only network call. Set the variables above in the `env` of the
`.mcp.json` entry, or in the developer's environment. Behind an HTTP proxy, also set
`NODE_USE_ENV_PROXY=1`, since Node ignores `HTTPS_PROXY` without it.

To try it without adding a dependency: `npx @xh/hoist-docs` from the project root.

## Behind an MCP gateway

`hoist-docs --http` serves MCP over Streamable HTTP at `/mcp` (port 8081, or `PORT`). It fetches
each library's index from the library's own channel as agents ask for it: a TypeScript library's
npm package (through the server's own `.npmrc`), keeping only its index, or hoist-core's Maven
artifact. It serves the newest release by default, or the release an agent names with `library`
and `version`. Fetched indexes are cached in `HOIST_DOCS_CACHE`. It keeps at most 12 parsed indexes in memory, or `MAX_LOADED_INDEXES`. Without registry access, give it a directory of index files
instead (`--index-dir`, or `INDEX_DIR`), which may hold several versions of each library.
`GET /health` reports what is loaded. Browser requests are checked against allowed origins
(localhost, plus `ALLOWED_ORIGINS`, comma-separated); agents and gateways send no `Origin` and
pass. Each release publishes the `Dockerfile`'s image as `ghcr.io/xh/hoist-docs` (tags `X.Y.Z`,
`X.Y`, `X` and `latest`); its header lists the mounts and variables. To serve a directory instead,
set `INDEX_DIR` and mount it.

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

Development requires Node 24 and pnpm; the published package runs on Node 20 or later. Node runs
the TypeScript source directly; the published package is
compiled (`pnpm build`, run automatically on pack).

```bash
pnpm install
pnpm build:react --root ../hoist-react   # build indexes from sibling checkouts into ./indexes
pnpm build:core --root ../hoist-core
pnpm build:react --root ../hoist-chat-kit
pnpm build:watch                         # rebuild ./indexes as the checkouts or builders change
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
pnpm build:react --root <hoist-react checkout> [--version 91.0.0]
pnpm build:react --root <hoist-chat-kit checkout> --library chat-kit [--version 2.0.0]
pnpm build:core --root <hoist-core checkout> [--version 45.0.0]
```

A TypeScript library's checkout needs its dependencies installed first, for type resolution.

## Shipping an index with a library

Each library builds its index in its own publish job, on the commit it is publishing, with the
version it is about to publish, for releases and snapshots alike.

- **TypeScript libraries:** add `@xh/hoist-docs-builder` as a dev dependency, run it before
  `npm publish` to write the gzipped index into the package, list it in `files`, and declare it in
  `package.json`:
  ```json
  "hoistDocs": {"id": "react", "index": "hoist-docs/index.json.gz"}
  ```
  An organization's own library does the same and is found the same way. Agent instructions in an
  index are used only from `@xh` packages.
- **hoist-core**, and any Grails library: depend on `io.xh:hoist-docs-builder` in a
  `docsBuilder` configuration, run it from a `JavaExec` task, and attach its output to the Maven
  publication with classifier `docs-index` and extension `json.gz` (see `buildDocsIndex` in
  hoist-core's `build.gradle`).

The library also needs its docs and a `docs/doc-registry.json`. An XH library gets a row in
`src/libraries.ts` and a golden set in `test/golden/`.

## Publishing

- **The tool** (`@xh/hoist-docs`): push a `vX.Y.Z` tag matching `package.json`; the `Release`
  workflow tests and publishes it.
- **The builders**, `@xh/hoist-docs-builder` on npm and `io.xh:hoist-docs-builder` on Maven
  Central, publish from the same tag and workflow, at the same version.
- **Snapshots**: every push to `develop` publishes all three through the `Deploy Snapshot` workflow -
  the npm packages as `<version>.<timestamp>` under the `next` dist-tag, the Grails builder as
  `1.0.0-SNAPSHOT` to Sonatype's snapshot repository. Libraries depend on the builder's `next` (or,
  for hoist-core, its `-SNAPSHOT`), so each of their builds uses the newest builder.
