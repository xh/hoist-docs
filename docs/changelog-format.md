# CHANGELOG Entry Format

Reference for writing and reviewing entries in the Hoist Docs `CHANGELOG.md`. Hoist Docs follows
the hoist-react changelog conventions, so an entry here reads like one there.

## Entry Structure

Every major version entry uses this structure. Minor and patch releases use whichever sections
apply.

```markdown
## {VERSION} - {YYYY-MM-DD}

### 💥 Breaking Changes (upgrade difficulty: {RATING})

* {Required change 1}
* {Required change 2}
    * {Sub-detail if needed}
* ...

### 🎁 New Features

* {Feature description}

### 🐞 Bug Fixes

* {Fix description}

### ⚙️ Technical

* {Internal change description}

### 📚 Libraries

* {Library} `{old} → {new}`
```

The topmost heading on `develop` is always the next version with a `-SNAPSHOT` suffix, as in
`## 2.0.0-SNAPSHOT - unreleased`, matching the version in `package.json`. New entries go under it.
At release time, the heading becomes the release version and date, which is a minor or patch
version when nothing breaks. After the release, a snapshot heading goes back on top.

## Section Headers

Use these emoji-prefixed headers consistently:

| Section | Header | When to Include |
|---------|--------|-----------------|
| Breaking Changes | `### 💥 Breaking Changes` | Required changes in apps, libraries or gateway setups |
| New Features | `### 🎁 New Features` | New tools, arguments, commands or builder options |
| Bug Fixes | `### 🐞 Bug Fixes` | Bugs fixed |
| Technical | `### ⚙️ Technical` | Internal changes worth noting, such as configuration or index schema |
| Libraries | `### 📚 Libraries` | Major dependency version bumps |

## What Counts as Breaking

Agent setups, Toolbox's viewer and libraries' publish jobs all depend on this repo, so these are
breaking changes:

- A renamed or removed MCP tool or argument, or a change to a tool's output text that agents rely on.
- A change to a `DocsCatalog` response shape.
- A builder change that libraries must adopt in their publish jobs.
- A raised minimum Node or JDK version.
- A renamed or removed environment variable or CLI option.

A new index schema version that older tools cannot read is not breaking for this repo, but say
which tool version a library's index now needs.

## Voice and Tense

- **Past tense, action-driven** for descriptions: "Enhanced", "Fixed", "Added", "Improved",
  "Removed", "Refactored"
- **Imperative** for developer instructions: "Update", "Adjust", "Remove", "Migrate"
- Avoid starting bullets with "New" (prefer "Added"), "Support for" (prefer "Added support for"),
  or present tense verbs like "Fix", "Allow", "Enable"
- Every bullet needs an explicit grammatical subject. No "Provides support for ..." or "Misc.
  improvements to ...". Open with a past-tense verb when reporting an action on the codebase, or
  with the symbol itself (`hoist-search-symbols` now ...) when a living API changed behavior.

### Examples

Good:
```markdown
* Added a `library` argument to `hoist-list-docs`, to browse one library's docs.
* Enhanced the TypeScript builder to index `@deprecated` and `@see` tags.
* Fixed `hoist-get-members` returning private members of hoist-core classes.
```

Bad:
```markdown
* New library argument for hoist-list-docs     (use "Added", not "New")
* Fix to private members in hoist-get-members  (use "Fixed", not "Fix to")
* Allow filtering docs by library              (use "Added", not "Allow")
```

## Breaking Changes Section

1. **Difficulty rating in the header** - append `(upgrade difficulty: {RATING})` to the section
   header. See Difficulty Ratings below for the rating scale.
2. **List** every required change as a separate bullet, saying who must make it: apps, library
   publish jobs, or gateway deployments.
3. **Be specific** - name exact tools, arguments, options and environment variables.

Each bullet should be concise (1-2 lines). When a change needs before/after examples, add upgrade
notes in `docs/upgrade-notes/v{N}-upgrade-notes.md` and link them in a standalone sentence right
after the header.

### Difficulty Ratings

```markdown
### 💥 Breaking Changes (upgrade difficulty: 🎉 TRIVIAL)
### 💥 Breaking Changes (upgrade difficulty: 🟢 LOW - {brief description})
### 💥 Breaking Changes (upgrade difficulty: 🟠 MEDIUM - {brief description})
### 💥 Breaking Changes (upgrade difficulty: 🔴 HIGH - {brief description})
```

## Libraries Section

List major dependency version changes with backtick-wrapped versions:

```markdown
### 📚 Libraries

* @modelcontextprotocol/server `2.4 → 3.0`
* minisearch `7.2 → 8.0`
```

Use abbreviated versions where the minor or patch is not significant (e.g. `3.0` not `3.0.1`).

## General Guidelines

- **Conciseness**: This is a changelog, not a guide. One bullet = one change, 1-3 lines max.
- **Specificity**: Name tools, arguments, options and environment variables in backticks.
- **Completeness**: Changes that affect agents, apps, library publish jobs, Toolbox or gateway
  deployments should be accounted for. Trivial changes (formatting, internal refactors with no
  behavioral impact, dev tooling updates) do not need to be included.
- **No duplication**: Do not repeat the same change across sections. Pick the most relevant section.
- **Issue/PR links**: Do not add GitHub issue or PR links (e.g. `[#12]`) to entries by default.
  Issue/PR references normally belong in the commit message and PR description.
- **Relevance test**: Include a fact only if someone adopting the release needs it. Exact counts,
  timings and token figures fail that test.
- **Punctuation**: End each bullet with a period. Plain ASCII punctuation only. Use " - " for an
  in-sentence break, never an em dash.
- **Line wrapping**: Hard-wrap list item text at 100 characters. Use two-space indentation for
  continuation lines.
