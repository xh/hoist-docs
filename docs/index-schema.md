# Index file schema (v1)

One JSON file per library version, written by that library's index builder and read by the Hoist
Docs service. The service never parses library source; everything it serves comes from these
files. Field names are shared across languages; a builder leaves out fields that do not apply.

File name: `<libraryId>-<version>.json` (for example `react-90.0.0-SNAPSHOT.json`,
`core-45.0-SNAPSHOT.json`). Optionally gzipped (`.json.gz`).

Builders:

- hoist-react: `pnpm build:index` (`docs-index/cli/build-index.ts`)
- hoist-core: `./gradlew :docs-index:buildIndex`

## Top level

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | number | `1`. The service refuses files with a version it does not know. |
| `library` | Library | Which library and version this file describes. |
| `docs` | Docs | Registry and markdown of every served doc. |
| `symbols` | Symbol[] | Every indexed symbol, with precomputed detail and members. |
| `memberIndex` | MemberIndexEntry[] | Members searchable by name, as the library's own search defined them. |

## Library

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Short id used in tool arguments: a built-in library's id from `src/libraries.ts` (`react`, `core`, `chat-kit`). |
| `name` | string | Package name: `@xh/hoist`, `io.xh:hoist-core`, `@xh/hoist-chat-kit`. |
| `version` | string | Released version or snapshot version. |
| `language` | string | `typescript` or `groovy`. |
| `gitSha` | string? | Commit the index was built from. |
| `builtAt` | string | ISO timestamp. |
| `description` | string? | One line for server instructions. |
| `instructions` | string? | Guidance for agents from a library other than hoist-react: its registry's `mcpInstructions`, as lines. |

## Docs

| Field | Type | Notes |
| --- | --- | --- |
| `mcpCategories` | `{id, title}[]` | From `docs/doc-registry.json`. |
| `viewerCategories` | `{id, title}[]` | From `docs/doc-registry.json`. |
| `entries` | DocEntry[] | Only docs whose files exist. |

**DocEntry:** `id` (path relative to the library root, e.g. `cmp/grid/README.md`), `title`,
`mcpCategory`, `viewerCategory`, `description`, `keywords[]`, `aliases[]`, `markdown` (full file
text). The service splits sections itself, so one implementation serves every library.

## Symbol

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | |
| `kind` | string | TS: `class`, `interface`, `type`, `function`, `const`, `enum`. Groovy: `class`, `interface`, `trait`, `enum`, `annotation`. |
| `filePath` | string | Relative to the library root. |
| `sourcePackage` | string | TS package dir (`cmp/grid`) or Groovy package (`io.xh.hoist.cache`). |
| `category` | string? | Groovy source category (`services`, `core`, ...). |
| `isExported` | boolean | Always true for Groovy. |
| `isAbstract` | boolean? | |
| `importPath` | string? | TS barrel import path, or null when no barrel re-exports it. |
| `isPromiseExtension` | boolean? | TS Promise prototype extensions, which need no import. |
| `doc` | string | JSDoc / Groovydoc text. |
| `hint` | string? | `@mcpHint` text, shown beside member hits. |
| `memberNames` | string? | Space-separated own member names, added to symbol search text. |
| `signature` | string | Declaration signature. |
| `extends` | string? | |
| `implements` | string[]? | |
| `decorators` | string[]? | Decorators or annotations. |
| `constructorType` | string? | TS. |
| `instanceOf` | string? | TS const that is an instance of an indexed class. |
| `members` | Member[]? | Class and interface members, own and inherited, unfiltered. |
| `externalMembers` | ExternalMemberGroup[]? | TS members inherited from types outside the index. |

**Member:** `name`, `kind` (`property`, `method`, `accessor`, `field`), `type`, `isStatic`,
`isOptional`?, `isAbstract`?, `visibility`?, `decorators[]`, `doc`, `default`?, `parameters`?
(`{name, type, description?}[]`), `returnType`?, `returns`? (`{type, description}`),
`inheritedFrom`?, `docInheritedFrom`?.

**ExternalMemberGroup:** `declaredIn`, `module` (npm package or null), `members`
(`{name, kind, type?}[]`).

## MemberIndexEntry

`name`, `memberKind`, `ownerName`, `ownerHint`?, `filePath`, `sourcePackage`, `isStatic`, `type`,
`doc`, `docInheritedFrom`?, `default`?, `decorators[]`, `parameters`?.

Owners whose members are searched only when the query names them (TS `*Props`) are flagged by the
service from the owner name, not in the file.
