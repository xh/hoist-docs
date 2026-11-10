# CLAUDE.md

Hoist Docs (Node 24, pnpm) serves Hoist documentation to AI agents over MCP: mainly as a local
tool each Hoist app installs as a dev dependency, which the agent launches over stdio, and also
over HTTP for organizations with an MCP gateway. XH does not host it. This repo also holds the
index builders. Read `docs/design.md` first.

- Node runs `src/` directly by stripping types: import local files with their `.ts` extension and
  use erasable syntax only (no enums, namespaces or parameter properties). `pnpm typecheck` checks.
  The published package is compiled (`pnpm build`), since Node will not strip types under
  `node_modules`.
- Over stdio, stdout carries only MCP messages: log through `log.ts`, never `console.log`.
- `src/docs/` is the browser-safe docs library: nothing it imports may reach Node APIs. A spec in
  `test/docs-library.spec.ts` checks.
- Follow hoist-react's coding conventions (`../hoist-react/docs/coding-conventions.md`) where they
  apply to plain TypeScript. Formatting is Prettier; run `pnpm lint` before finishing.
- Search ranking in `src/index` (`DocSearch`, `SymbolSearch`, `search-text.ts`) must stay identical
  to hoist-react's original search. `pnpm test` includes a parity spec against a checked-in index
  and recorded results (`test/parity.spec.ts`); it must stay green.
- Each library has a golden set in `test/golden/`, run by `test/golden.spec.ts`. Expectations
  come from the docs and API, never from search output: don't edit a case to make it pass.
- The index builders in `builders/` must keep working for every release from hoist-react v83 and
  hoist-core v37 onward, not just the libraries' current source. Check a builder change against an
  old tag as well as a current checkout.
- Keep tool names, arguments and output text stable: existing agent setups depend on them. Keep
  `DocsCatalog`'s response shapes stable too: Toolbox's viewer reads them.
- `src/local/checkout.ts` (`export-docs --from-checkout`) reproduces the builders' rules for the
  docs part of an index. A change to those rules in a builder must be matched there.
- Keep the service light: no database, no auth, no admin UI, `minisearch` the only runtime
  dependency. Configuration is environment variables only. Builder dependencies (`ts-morph`, the
  JDK) stay out of the service.
- Branching, committing and pushing require an explicit ask, as in the sibling repos. No AI
  attribution in commit messages or PR descriptions. No em dashes in prose or comments.
