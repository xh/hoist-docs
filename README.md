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
- fetches hoist-core's index from Maven for the app's hoist-core version - Maven Central for
  releases, Sonatype's snapshot repository for snapshots, or an organization's mirror
  (`HOIST_DOCS_MAVEN_REPO`, `HOIST_DOCS_MAVEN_SNAPSHOT_REPO`, with `HOIST_DOCS_MAVEN_USER` and
  `HOIST_DOCS_MAVEN_PASSWORD` if needed) - and caches it in `~/.cache/hoist-docs`;
- fetches, from the same repository, the index of each Grails library listed in
  `hoistDocsLibraries` in `gradle.properties`, such as the organization's own plugin (see
  [Shipping an index with a library](#shipping-an-index-with-a-library));
- serves them.

The tool finds the hoist-core version in `gradle.lockfile`, else in `hoistCoreVersion` in
`gradle.properties`. An app that gets hoist-core through its organization's own Grails plugin
needs a committed `gradle.lockfile`, which lists hoist-core along with the plugin. To create one,
turn on dependency locking in `build.gradle` (`dependencyLocking { lockAllConfigurations() }`),
run `./gradlew dependencies --write-locks`, and commit `gradle.lockfile`.

Every index is exactly the installed build, snapshots included. After a Hoist upgrade, restart the
agent.

Maven is the tool's only network access. Set the variables above in the `env` of the
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

Development requires Node 24 and pnpm. Node runs the TypeScript source directly. The published
packages, the tool and the TypeScript builder, are compiled (`pnpm build`, run automatically on
pack) and run on Node 20 or later.

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
pnpm build:core --root <plugin checkout> --library acme --name com.acme:acme-hoist [--version 3.2.0]
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
  An organization's own library does the same and is found the same way.
- **hoist-core**, and any Grails library: depend on `io.xh:hoist-docs-builder` in a
  `docsBuilder` configuration, run it from a `JavaExec` task, and attach its output to the Maven
  publication with classifier `docs-index` and extension `json.gz` (see `buildDocsIndex` in
  hoist-core's `build.gradle`).

  A Grails library other than hoist-core, such as an organization's own plugin, sets up the same
  task with builder 2.0.0 or later and names itself in the builder's arguments:

  ```groovy
  args '--root', projectDir.absolutePath, '--version', version,
      '--library', 'acme', '--name', 'com.acme:acme-hoist',
      '--description', 'Acme extensions to hoist-core',
      '--file', docsIndexFile.get().asFile.absolutePath
  ```

  The id prefixes the library's doc ids (`acme:docs/entitlements.md`) and is the `library`
  argument agents pass. Use lowercase letters, digits and `-`, and do not reuse `react`, `core` or
  `chat-kit`.

  Each app that uses the library lists it in `gradle.properties`, comma-separated, and the tool
  serves the version its `gradle.lockfile` locks:

  ```properties
  hoistDocsLibraries=com.acme:acme-hoist
  ```

  The tool asks `HOIST_DOCS_MAVEN_REPO` (or `HOIST_DOCS_MAVEN_SNAPSHOT_REPO`, for a snapshot) for
  the index, so point those at the repository that hosts the library.

The library also needs its docs and a `docs/doc-registry.json`. Its `mcpInstructions` there go
into its index as agent guidance, for example "Read acme:docs/upgrade-notes.md before
hoist-react's upgrade notes." The tool passes that guidance to the agent from XH's libraries and
from libraries the app chose itself: listed in `client-app/package.json`, or in
`hoistDocsLibraries`. An npm library that arrives only through another is served, but its
guidance is dropped. An XH library gets a row in `src/libraries.ts`
and a golden set in `test/golden/`.

## Publishing

- **Releases**: change the top heading of [`CHANGELOG.md`](CHANGELOG.md) to the release version
  and date, merge `develop` into `master`, then run the `Deploy Release` workflow from `master`
  with the version. It tests, publishes the tool (`@xh/hoist-docs`) and the TypeScript builder
  (`@xh/hoist-docs-builder`) to npm, the Grails builder (`io.xh:hoist-docs-builder`) to Maven
  Central and the gateway image to GHCR, all at that version, then tags the commit and creates a
  GitHub release. `package.json` stays on its `-SNAPSHOT` version: the workflow sets the release
  version for the run, as hoist-react's does. Hotfixes run from their own branch with `is-hotfix`
  checked. Entries follow [`docs/changelog-format.md`](docs/changelog-format.md).
- **Snapshots**: every push to `develop` publishes all three through the `Deploy Snapshot` workflow -
  the npm packages as `<version>.<timestamp>` under the `next` dist-tag, the Grails builder at
  `package.json`'s `-SNAPSHOT` version to Sonatype's snapshot repository. Libraries depend on the
  builder's `next` (or, for hoist-core, its `-SNAPSHOT`), so each of their builds uses the newest
  builder.
