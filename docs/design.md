# Hoist Docs: unified MCP server and docs API

Design document. Source of truth while the project is under way; update it as decisions change.
Original draft and discussion: https://claude.ai/artifact/UAw4RnTApjAJTuCjJiRuyN

## Summary

Replace the two stdio MCP servers bundled with hoist-react and hoist-core, and the docs backend in
Toolbox, with one small TypeScript service: **Hoist Docs** (this repo). It serves an MCP endpoint
for agents and a public docs API for Toolbox's docs viewer, both from versioned indexes built in
each library's CI. People keep reading docs in Toolbox, beside the live examples.

- **Why now:** an important client requires MCP servers to run through their gateway. Gateways
  front HTTP endpoints; ours speak only stdio. Bundling also puts six MCP-only packages into every
  Hoist app's dependency tree.
- **What changes:** hoist-react and hoist-core stop shipping any MCP runtime code. Each repo keeps
  only an index builder that runs in CI.
- **Two deployments, one codebase:** XH-hosted and an on-prem container behind the client's
  gateway.

## Why not a Hoist app

The first version of this repo was a Hoist application (Grails server, hoist-react admin client),
kept at the `grails-prototype` tag. It was dropped because, with every endpoint anonymous, the
Hoist stack carried far more than the service needs:

- The admin console was the main thing Hoist provided, and it needs authentication (it exposes
  configs and logs). Auth0 services, a user domain, a database, Hazelcast and a client build all
  existed only to support it.
- The service is stateless and read-only. A Grails app with a database is a heavy thing to hand a
  client for an on-prem container, and a heavy second app to run locally beside Toolbox.
- Being in Groovy forced a port of hoist-react's TypeScript search, held identical by a parity
  spec. In TypeScript the original search code is reused instead of ported.

Usage visibility moves from the admin console to structured logs (see below). If per-user auth or
an admin UI is needed later, it can be added to this service or fronted by a gateway.

## Decisions in force

| Topic | Decision |
| --- | --- |
| Language and runtime | TypeScript on Node 24 LTS, pnpm. Compiled with `tsc` for production; `tsx watch` in development. |
| HTTP | Node's built-in `http` server with a small router. No web framework unless one earns its place. |
| MCP | Official `@modelcontextprotocol/sdk`, stateless Streamable HTTP at `/mcp`. |
| Search | hoist-react's existing search and formatter code, moved here and adapted to read index files. One ranking for every library, including hoist-core (previously substring search). |
| Public access | Everything is anonymous: `/mcp` and the read-only `docs/registry`, `docs/content` and `docs/search` API. Per-user MCP auth (MCP OAuth, gateway modes) comes later, if at all. |
| Docs viewer | **Stays in Toolbox**, desktop and mobile, where docs link to live examples and back. Toolbox's server fetches registry, content and search from this service (`hoistDocsUrl` config). |
| API contract | `/mcp` tools and `docs/*` responses keep exactly the shapes the `grails-prototype` served, so Toolbox and agent setups need no change. |
| Configuration | Environment variables only (see below). No database, no instance configs. |
| Usage tracking | One structured JSON log line per MCP call and docs search. |
| Versions | Index per published version plus `develop`; never read Git per query. |
| Local port | `8081` by default, so it runs beside a local Toolbox (8080) and matches Toolbox's documented local `hoistDocsUrl`. |
| Offline | Not supported, not needed. |
| Branches | `develop` in this repo; `hoist-docs` in hoist-react, hoist-core and Toolbox. |
| CLI | `hoist-docs` CLI name kept; becomes a thin client of this service when the old servers retire. |

## Current state

| Component | Where | Language and size | How it runs | Problems |
| --- | --- | --- | --- | --- |
| hoist-react MCP server and CLIs | `hoist-react/mcp/`, `bin/hoist-mcp.mjs` (removed on the `hoist-docs` branch) | TypeScript, ~11.6k lines incl. tests | stdio, `tsx` executes TS source at runtime | `@modelcontextprotocol/sdk`, `ts-morph`, `tsx`, `zod`, `commander`, `minisearch` are runtime `dependencies` of `@xh/hoist`, used only by `mcp/` and `bin/`. `mcp/` and `bin/` ship in the npm package. |
| hoist-core MCP server and CLIs | `hoist-core/mcp/`, artifact `io.xh:hoist-core-mcp` | Groovy, ~2.6k lines | stdio, fat jar via `mcp/bootstrap.sh` | `bootstrap.sh` downloads jars with `curl --ssl-no-revoke`, no integrity check. MCP Java SDK pulled in Jackson CVEs. Substring search, not ranked. |
| Toolbox docs viewer | Toolbox `DocsService`, desktop and mobile UI | Groovy + TS | On the `hoist-docs` branch, calls this service's docs API | None once this service is running. |
| Context7 | `hoist-core/context7.json` | External | Third party | No symbol tools, no ranking control, no visibility. |

## Goals and non-goals

**Goals**

- Serve hoist-react, hoist-core and companion-library docs and symbols over MCP Streamable HTTP so
  any MCP gateway can front it.
- Ship no MCP runtime code or dependencies inside `@xh/hoist` or the hoist-core jar.
- One implementation for agents and people, replacing two MCP servers and the Toolbox docs backend.
- Answer for any released version plus `develop`.
- Usage visible from the service's logs.
- Keep tool names and output stable so existing agent setups and skills keep working.
- Light to run: one process, one port, fast startup, small container image.

**Non-goals**

- Offline use. Live reading of a developer's uncommitted checkout. Indexing application code. Any
  write operation. An admin UI.

## Architecture

```mermaid
flowchart TB
    R[hoist-react CI<br/>ts-morph extractor] --> I
    C[hoist-core CI<br/>Groovy AST extractor] --> I
    X[Companion library CI] --> I
    I[Versioned index files<br/>one shared schema] -->|loaded on first request, cached| S
    subgraph S[Hoist Docs service - Node]
        IR[Index reader<br/>versions + ranked search]
        M["/mcp endpoint<br/>7 read-only tools"]
        D["docs/* API<br/>registry, content, search"]
        L[Structured usage logs]
    end
    G[Client MCP gateway<br/>on-prem] --> M
    A[Agents] --> G
    T[Toolbox server] --> D
    P[People] --> TV[Toolbox docs viewer<br/>desktop + mobile]
    TV --> T
```

## Index format and build pipeline

Each library builds one self-contained JSON index per release in CI, with its own toolchain. The
service only reads these files; it never parses source. The schema lives in
[`index-schema.md`](./index-schema.md).

- **Contents:** header (library, version, git SHA, build time, `schemaVersion`); doc registry
  entries; doc markdown and sections; symbols; members; precomputed symbol details.
- **Builders:** hoist-react `pnpm build:index` (`docs-index/`); hoist-core Gradle task
  `:docs-index:buildIndex`.
- **Publishing:** attached to GitHub releases and published with the library; `develop` rebuilt on
  push. `schemaVersion` checked on load.

## Versioning

- Selection by optional `version` argument on each tool (or the viewer's version picker); default
  is the newest loaded version.
- Index sources, in order: a local index directory (`INDEX_DIR`, used for dev and on-prem), then
  GitHub release assets (hosted).
- Tagged versions are cached indefinitely. `develop` is re-fetched on a timer
  (`DEVELOP_REFRESH_MINS`) and on restart.

## MCP endpoint and tools

One stateless Streamable HTTP endpoint at `/mcp`, built on the official MCP SDK; no sessions.

| Tool | Arguments | Replaces |
| --- | --- | --- |
| `hoist-search-docs` | `query`, `library`?, `category`?, `limit`?, `version`? | `hoist-search-docs`, `hoist-core-search-docs` |
| `hoist-list-docs` | `library`?, `category`?, `version`? | `hoist-list-docs`, `hoist-core-list-docs` |
| `hoist-read-doc` | `id`, `section`?, `outline`?, `library`?, `version`? | `hoist-read-doc`, `hoist-core-read-doc` |
| `hoist-search-symbols` | `query`, `library`?, `kind`?, `limit`?, `version`? | `hoist-search-symbols`, `hoist-core-search-symbols` |
| `hoist-get-symbol` | `name`, `file`?, `library`?, `version`? | `hoist-get-symbol`, `hoist-core-get-symbol` |
| `hoist-get-members` | `name`, `filter`?, `file`?, `library`?, `version`? | `hoist-get-members`, `hoist-core-get-members` |
| `hoist-ping` | none | both pings; reports loaded versions |

- `library` is `react`, `core` or a companion id; omitted, results span all and are labelled.
- `hoist-core-*` names are accepted as aliases (scoped to `core`).
- All tools are annotated read-only.

## Docs API for viewers

Toolbox's desktop and mobile viewers stay in Toolbox, so docs keep their links to live examples.
Toolbox's server calls this service's public docs API:

| Endpoint | Returns |
| --- | --- |
| `GET docs/registry` | Every doc's id, source, title, viewer category, description and keywords, plus each source's categories, loaded version and available versions |
| `GET docs/content?source&docId` | One doc's markdown |
| `GET docs/search?query&limit` | Ranked docs, each once with its best section and an excerpt - the same ranking as `hoist-search-docs` |

Each endpoint takes an optional version per source, as a param named for the source
(`hoist-react=86.2.0`), and an optional `client` param (Toolbox passes `toolbox`) used in usage
logs. Response shapes match the `grails-prototype` `DocsController` exactly.

## Code sources

| Existing code | Fate |
| --- | --- |
| hoist-react `mcp/data/doc-search.ts`, `symbol-search.ts`, `search-text.ts`, `doc-id-resolver.ts`, `doc-sections.ts`, `mcp/formatters/`, `mcp/tools/`, `mcp/instructions.ts` | Moved here from the last hoist-react commit that had them (parent of `831f86871`), adapted to read index files instead of a live ts-morph registry |
| `grails-prototype` `index/` package (`LibraryIndex`, `DocTools`, `SymbolTools`, `DocSearch`) and `DocsController`, `McpService` | Reference for that adaptation: how the index-file data maps onto the search code, and the exact docs API shapes |
| hoist-react `docs-index/` (`ts-registry.ts`, `doc-registry.ts`, `import-paths.ts`) | Stays in hoist-react as the index builder |
| hoist-core `GroovyRegistry`, `DocRegistry` | Stay in hoist-core as the index builder |
| hoist-react `server.ts`, `resources/`, `bin/hoist-mcp.mjs`, MCP-only dependencies | Removed from hoist-react |
| hoist-core `HoistCoreMcpServer`, `bootstrap.sh`, MCP SDK | Removed from hoist-core |

Tests move with the search code. Golden-set queries from the parity fixtures become ordinary
ranking tests, run against checked-in sample indexes.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8081` | HTTP port. |
| `INDEX_DIR` | `./indexes` | Directory holding `react-<version>.json[.gz]`, `core-<version>.json[.gz]` and companion indexes. |
| `DEVELOP_REFRESH_MINS` | `15` | How often to re-fetch `develop` indexes on the hosted service. |
| `LOG_QUERIES` | `false` | Include query text in usage logs. |

## Usage visibility

Each MCP call and docs search writes one JSON log line: `category` (`MCP` / `Docs`), tool or
endpoint, elapsed ms, library, version, result count, client, and the query text only when
`LOG_QUERIES` is on. Hosted, these go to the platform's log collection; on-prem, to the client's.

## Deployment

- **On-prem:** a container image (Node slim base) with the indexes for the agreed releases baked in
  under `INDEX_DIR`. No database or other services.
- **Hosted:** the same image, fetching release assets from GitHub, behind XH's usual TLS ingress.
- **Local:** `pnpm dev` on port 8081 beside a local Toolbox, with `hoistDocsUrl` set to
  `http://localhost:8081` in Toolbox's `.env`.

## Phases

1. Index format and builders (done in hoist-react and hoist-core).
2. Service core: scaffold, index loading, search code moved in, `/mcp` and `docs/*`, tests.
3. On-prem release: container image with baked indexes.
4. Hosted service.
5. Retire old servers and Context7.

## Arguments against (summary)

Strongest: XH becomes a service operator; scope beyond the client's ask. Answered by ordering:
on-prem first, anonymous now, measure, then decide on hosting and per-user MCP auth. Dropping the
Hoist stack also lowers the operator cost: a stateless container with no database. Full table in
the original draft.

## Open questions

- [ ] What exactly does the client's gateway do with identity?
- [ ] Hosted at all, or on-prem only until demand shows?
- [ ] Log query text on the hosted service?
- [ ] How many past releases to bake into the on-prem image?
- [ ] Which companion libraries are in scope first?
- [ ] Does the current MCP SDK support the 2026-07-28 `server/discover` flow, or do we add it?
