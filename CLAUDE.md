# CLAUDE.md

Hoist Docs is a small, stateless TypeScript service (Node, pnpm) that serves Hoist documentation
over MCP and through a public docs API used by Toolbox. Read `docs/design.md` first.

- Follow hoist-react's coding conventions (`../hoist-react/docs/coding-conventions.md`) where they
  apply to plain TypeScript.
- The search and formatter code comes from hoist-react's former `mcp/` directory. Keep tool names,
  arguments and output stable: existing agent setups depend on them. The `/mcp` and `docs/*`
  response shapes must match the `grails-prototype` tag, which Toolbox calls.
- Keep the service light: no database, no auth, no admin UI. Configuration is environment
  variables only.
- Branching, committing and pushing require an explicit ask, as in the sibling repos. No AI
  attribution in commit messages or PR descriptions. No em dashes in prose or comments.
