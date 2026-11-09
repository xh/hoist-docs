# CLAUDE.md

Hoist Docs is a small, stateless TypeScript service (Node 24, pnpm) that serves Hoist documentation
over MCP and through a public docs API used by Toolbox. Read `docs/design.md` first.

- Node runs `src/` directly by stripping types: import local files with their `.ts` extension and
  use erasable syntax only (no enums, namespaces or parameter properties). `pnpm typecheck` checks.
- Follow hoist-react's coding conventions (`../hoist-react/docs/coding-conventions.md`) where they
  apply to plain TypeScript. Formatting is Prettier; run `pnpm lint` before finishing.
- Search ranking in `src/index` (`DocSearch`, `SymbolSearch`, `search-text.ts`) must stay identical
  to hoist-react's original search. `pnpm test` includes a parity spec against a checked-in index
  and recorded results (`test/parity.spec.ts`); it must stay green.
- Each library has a golden set in `test/golden/`, run by `test/golden.spec.ts`. Expectations
  come from the docs and API, never from search output: don't edit a case to make it pass.
- Keep tool names, arguments and output text stable: existing agent setups depend on them. The
  `docs/*` response shapes are what Toolbox's `DocsService` reads.
- Keep the service light: no database, no auth, no admin UI, `minisearch` the only runtime
  dependency. Configuration is environment variables only.
- Branching, committing and pushing require an explicit ask, as in the sibling repos. No AI
  attribution in commit messages or PR descriptions. No em dashes in prose or comments.
