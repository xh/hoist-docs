/**
 * Generates the search parity fixtures in `src/test/resources/parity` from hoist-react's
 * TypeScript search, for SearchParitySpec. Run from a hoist-react checkout at the same commit as
 * the index under test, while its `mcp/data` search code still exists:
 *
 *   cp ../hoist-docs/scripts/generate-parity-fixtures.ts mcp/cli/ && \
 *     HOIST_MCP_QUIET=1 node --import tsx mcp/cli/generate-parity-fixtures.ts \
 *     ../hoist-docs/src/test/resources/parity && rm mcp/cli/generate-parity-fixtures.ts
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {loadRegistry} from '../data/doc-registry.js';
import {searchDocs} from '../data/doc-search.js';
import {searchSymbols} from '../data/symbol-search.js';
import {resolveRepoRootPosix} from '../util/paths.js';

const root = resolveRepoRootPosix(),
    rel = (p: string) => (p.startsWith(root + '/') ? p.slice(root.length + 1) : p),
    queriesFrom = (f: string) =>
        [...readFileSync(new URL(f, import.meta.url), 'utf8').matchAll(/query: '([^']*)'/g)].map(m => m[1]);

const docQueries = [...new Set([...queriesFrom('../data/doc-search.spec.ts'), 'grid', 'persistWith', 'XH.confirm', 'websocket', 'authentication oauth'])],
    symQueries = [...new Set([...queriesFrom('../data/symbol-search.spec.ts'), 'GridModel', 'button icon', 'ButtonProps', 'chooserNameColumn', 'catchDefault', 'Store'])];

const registry = loadRegistry().entries.filter(e => e.library == null);
const docs = docQueries.map(q => ({
    query: q,
    results: searchDocs(registry, q, {limit: 10}).map(r => ({id: r.entry.id, section: r.section.ref, score: r.score}))
}));

const syms = [];
for (const q of symQueries) {
    for (const includeInternal of [false, true]) {
        const r = await searchSymbols(q, {limit: 20, includeInternal});
        syms.push({
            query: q,
            includeInternal,
            symbols: r.symbols.map(h => ({name: h.entry.name, filePath: rel(h.entry.filePath), score: h.score, factory: h.factory ?? null, props: h.props ?? null})),
            members: r.members.map(h => ({owner: h.entry.ownerName, name: h.entry.name, score: h.score})),
            symbolTotal: r.symbolTotal,
            memberTotal: r.memberTotal,
            hiddenSymbols: r.hiddenSymbols,
            hiddenMembers: r.hiddenMembers
        });
    }
}

const out = process.argv[2];
writeFileSync(`${out}/doc-search.json`, JSON.stringify(docs, null, 1));
writeFileSync(`${out}/symbol-search.json`, JSON.stringify(syms, null, 1));
console.log(`doc queries: ${docs.length}, symbol cases: ${syms.length}`);
