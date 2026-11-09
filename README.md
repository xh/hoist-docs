# Hoist Docs

Small TypeScript service that serves Hoist framework documentation and API reference:

- **`/mcp`** - an MCP server (Streamable HTTP, stateless) for AI coding agents, with the tools
  previously bundled as stdio servers in hoist-react and hoist-core: `hoist-search-docs`,
  `hoist-list-docs`, `hoist-read-doc`, `hoist-search-symbols`, `hoist-get-symbol`,
  `hoist-get-members`, `hoist-ping`. Open to anonymous callers, so it can sit behind an MCP gateway.
- **`docs/*` API** - public, read-only registry, content and search, used by Toolbox's desktop and
  mobile docs viewers.

See [`docs/design.md`](docs/design.md) for the design and [`docs/index-schema.md`](docs/index-schema.md)
for the index files it serves.

**Status:** being rebuilt as a TypeScript service. The earlier Grails/Hoist version is at the
`grails-prototype` tag.
