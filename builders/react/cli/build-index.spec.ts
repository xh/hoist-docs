/**
 * Schema conformance checks for the index built from a hoist-react checkout. The service refuses
 * an index whose shape it does not expect, so these guard the contract described in
 * `docs/index-schema.md`. Needs a checkout with dependencies installed, so runs only when
 * HOIST_REACT_ROOT names one:
 *
 *   HOIST_REACT_ROOT=../hoist-react pnpm test
 */
import assert from 'node:assert/strict';

import {beforeAll, describe, it} from 'vitest';

import {buildIndex, SCHEMA_VERSION} from './build-index.ts';

process.env.HOIST_MCP_QUIET = '1';

describe.skipIf(!process.env.HOIST_REACT_ROOT)('hoist-react buildIndex', () => {
    let index: any;
    beforeAll(async () => {
        index = await buildIndex();
    }, 300_000);

    it('declares the schema version and library', () => {
        assert.equal(index.schemaVersion, SCHEMA_VERSION);
        assert.equal(index.library.id, 'react');
        assert.equal(index.library.name, '@xh/hoist');
        assert.equal(index.library.language, 'typescript');
        assert.ok(index.library.version);
    });

    it('includes every registered doc with its markdown and categories', () => {
        const {docs} = index;
        assert.ok(docs.entries.length > 50);
        assert.ok(docs.mcpCategories.length > 0 && docs.viewerCategories.length > 0);
        for (const e of docs.entries) {
            assert.ok(e.id && e.title && e.mcpCategory, `doc ${e.id}`);
            assert.equal(typeof e.markdown, 'string', `doc ${e.id}`);
            assert.ok(Array.isArray(e.keywords) && Array.isArray(e.aliases), `doc ${e.id}`);
        }
    });

    it('uses library-relative file paths for symbols and members', () => {
        for (const s of index.symbols) assert.ok(!s.filePath.startsWith('/'), s.filePath);
        for (const m of index.memberIndex) assert.ok(!m.filePath.startsWith('/'), m.filePath);
    });

    it('precomputes detail and members', () => {
        const gridModel = index.symbols.find((s: any) => s.name === 'GridModel');
        assert.equal(gridModel.importPath, '@xh/hoist/cmp/grid');
        assert.ok(gridModel.signature.includes('class GridModel'));
        assert.ok(gridModel.members.some((m: any) => m.name === 'sortBy'));

        const xh = index.symbols.find((s: any) => s.name === 'XH' && s.kind === 'const');
        assert.equal(xh.instanceOf, 'XHApi');
    });

    it('does not index builder or old MCP server source', () => {
        assert.ok(
            !index.symbols.some(
                (s: any) => s.filePath.startsWith('docs-index/') || s.filePath.startsWith('mcp/')
            )
        );
    });
});
