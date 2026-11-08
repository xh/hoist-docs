# CLAUDE.md

Hoist Docs is a Hoist application (Grails server via hoist-core, React client via hoist-react)
that serves Hoist documentation over MCP and in a docs viewer. Read `docs/design.md` first.

- Follow the coding conventions of hoist-react (`../hoist-react/docs/coding-conventions.md`) and
  hoist-core (`../hoist-core/docs/coding-conventions.md`). Toolbox (`../toolbox`) is the
  reference for app structure.
- Search code in `src/main/groovy/io/xh/hoistdocs/index` is a port of hoist-react's MCP search.
  Its ranking must stay identical: run `./gradlew test -PtestIndexDir=<dir>` after any change.
- Branching, committing and pushing require an explicit ask, as in the sibling repos. No AI
  attribution in commit messages or PR descriptions. No em dashes in prose or comments.
