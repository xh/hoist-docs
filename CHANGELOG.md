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

### 🎁 New Features

* The local tool now reads the hoist-core version from `gradle.lockfile` first, then from
  `hoistCoreVersion` in `gradle.properties`.
* The local tool now finds hoist-core's version for apps that get hoist-core through their
  organization's own Grails plugin and do not set `hoistCoreVersion`. It reads the POMs of the
  dependencies that `build.gradle` declares, from the configured Maven repository.
* The local tool now serves the docs index of any Grails plugin an app depends on whose POM
  declares one with the property `hoistDocs.id`. It looks for these when `HOIST_DOCS_MAVEN_REPO`
  or `HOIST_DOCS_MAVEN_SNAPSHOT_REPO` names an organization's own repository, and fetches each
  plugin's `docs-index` artifact from there. See the README for the build and publish steps.
* The Grails builder (`io.xh:hoist-docs-builder`) now takes `--library`, `--name` and
  `--description`, so it can index a Grails library other than hoist-core. Such an index also
  carries the `mcpInstructions` of the library's `docs/doc-registry.json`.
* With a second Grails library loaded, the server instructions now name each server library.
* The local tool now passes on the agent instructions of any library the app depends on directly,
  in `client-app/package.json` or `build.gradle`, as well as XH's own. An organization's own
  libraries can steer the agent, for example to read their upgrade notes first. Libraries that
  arrive only through another dependency still have their instructions dropped.

### 🐞 Bug Fixes

* The local tool now tells the agent when it cannot find a Grails app's hoist-core version, in its
  instructions and `hoist-ping`. Before, it left hoist-core out without a word.

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
