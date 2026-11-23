# Changelog

<!--
  Entry conventions: docs/changelog-format.md - read it before adding entries here.

  The three rules that account for most review feedback:

  1. Every bullet needs an explicit grammatical subject. No "Provides support for ..." or "Misc.
     improvements to ...".
  2. Open with a past-tense verb (Added / Fixed / Removed / Renamed) when reporting an action on the
     codebase, or with the symbol itself (`Foo.bar` now ...) when a living API changed behavior.
  3. Plain ASCII punctuation only. Use " - " for in-sentence breaks, never an em dash.
-->

## 2.0.0-SNAPSHOT - unreleased

## 1.1.0 - 2026-11-23

### 🎁 New Features

* The local tool now serves the docs index of each Grails library an app lists in
  `hoistDocsLibraries` in `gradle.properties`, such as an organization's own plugin, at the
  version `gradle.lockfile` locks. See the README for the build and publish steps.
* The Grails builder (`io.xh:hoist-docs-builder`) now takes `--library`, `--name` and
  `--description`, so it can index a Grails library other than hoist-core. Such an index also
  carries the `mcpInstructions` of the library's `docs/doc-registry.json`.
* With a second Grails library loaded, the server instructions now name each server library.
* The local tool now passes on the agent instructions of libraries the app chose itself, listed in
  `client-app/package.json` or in `hoistDocsLibraries`, as well as XH's own. An npm library that
  arrives only through another dependency still has its instructions dropped.
* The local tool now reads the hoist-core version from `gradle.lockfile` first, then from
  `hoistCoreVersion` in `gradle.properties`, and warns when the two disagree. A lockfile lists
  hoist-core even when an app gets it through its organization's own Grails plugin, so those apps
  need not set `hoistCoreVersion`.

### 🐞 Bug Fixes

* The local tool now tells the agent when it cannot find a Grails app's hoist-core version, in its
  instructions and `hoist-ping`. Before, it left hoist-core out without a word.
* The local tool no longer reads the next line of `gradle.properties` as the value of a property
  left empty, such as `xhReleaseVersion=` in a hoist-core checkout.
* Fixed `@xh/hoist-docs-builder` to declare Node 20 or later, as the tool does. It declared Node 24,
  so package managers that enforce `engines` refused to install it on Node 20 or 22.

## 1.0.0 - 2026-11-19

The first release of Hoist Docs, which serves Hoist documentation and API reference to AI coding
agents over MCP. One tool serves hoist-react, hoist-core and hoist-chat-kit, replacing the MCP
servers those libraries bundled, with the same tool names and arguments. See the
[README](README.md) to add it to an app, and [`docs/design.md`](docs/design.md) for the design.

Requires Node 20 or later.

### 🎁 New Features

* Added the `hoist-docs` MCP server, with the tools `hoist-search-docs`, `hoist-list-docs`,
  `hoist-read-doc`, `hoist-search-symbols`, `hoist-get-symbol`, `hoist-get-members` and
  `hoist-ping`. Search ranks results exactly as hoist-react's original search did.
* Added the local tool, which an app installs as a dev dependency and its agent launches over
  stdio from `.mcp.json`. It serves exactly the library versions the app uses, snapshots included:
  the index inside each installed package that declares `hoistDocs`, and hoist-core's index for
  `hoistCoreVersion`, fetched from Maven and cached in `~/.cache/hoist-docs`.
* Added discovery of any installed package with a `hoistDocs` entry, so an organization's own
  libraries can ship an index and be served beside Hoist's. Agent instructions in an index are used
  only from `@xh` packages.
* Added `hoist-docs --http`, which serves MCP over Streamable HTTP for organizations with an MCP
  gateway. It fetches each library's index from the library's own channel on demand, can serve
  several versions of each library, and reports what is loaded at `GET /health`.
* Added the gateway image, `ghcr.io/xh/hoist-docs`, published on each release.
* Added `@xh/hoist-docs/docs`, a browser-safe library for docs viewers such as Toolbox's, with the
  same ranking as the MCP tools, and `hoist-docs export-docs` to write its payloads, from installed
  packages or straight from library checkouts with `--from-checkout`.
* Added the index builders, published at the same version as the tool: `@xh/hoist-docs-builder`
  for hoist-react and other TypeScript libraries, and `io.xh:hoist-docs-builder` for hoist-core
  and other Grails libraries. Each library runs one in its own publish job to ship its index with
  each release and snapshot.

### ⚙️ Technical

* Configured the tool through environment variables only, such as `HOIST_DOCS_MAVEN_REPO` for an
  organization's Maven mirror and `HOIST_DOCS_CACHE` for the index cache. See the README and
  [`docs/design.md`](docs/design.md) for the full list.
