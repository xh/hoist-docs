/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {utimesSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {describe, expect, it} from 'vitest';

import {loadConfig} from '../src/config.ts';
import {LibraryIndex} from '../src/index/LibraryIndex.ts';
import {compareVersions, IndexStore, NotFoundError} from '../src/IndexStore.ts';
import {DocTools} from '../src/tools/DocTools.ts';
import {SymbolTools} from '../src/tools/SymbolTools.ts';
import {coreIndex, reactIndex, writeIndexDir} from './fixtures.ts';

const react = new LibraryIndex(reactIndex()),
    core = new LibraryIndex(coreIndex());

describe('DocIdResolver', () => {
    const resolve = (input: string) => {
        const r = react.resolver.resolve(input);
        return r.kind === 'unknown'
            ? {kind: r.kind, suggestions: r.suggestions}
            : {kind: r.kind, id: r.entry.id};
    };

    it('resolves exact, normalized, case-insensitive and aliased ids', () => {
        expect(resolve('cmp/grid/README.md')).toEqual({kind: 'exact', id: 'cmp/grid/README.md'});
        expect(resolve('./cmp//grid/README.md')).toEqual({
            kind: 'normalized',
            id: 'cmp/grid/README.md'
        });
        expect(resolve('CMP/GRID/readme.md')).toEqual({
            kind: 'normalized',
            id: 'cmp/grid/README.md'
        });
        expect(resolve('grid')).toEqual({kind: 'normalized', id: 'cmp/grid/README.md'});
        expect(resolve('cmp/grid')).toEqual({kind: 'normalized', id: 'cmp/grid/README.md'});
        expect(resolve('persistence')).toEqual({kind: 'normalized', id: 'docs/persistence.md'});
        expect(resolve('v85')).toEqual({
            kind: 'normalized',
            id: 'docs/upgrade-notes/v85-upgrade-notes.md'
        });
        expect(resolve('index')).toEqual({kind: 'normalized', id: 'docs/README.md'});
    });

    it('suggests ids for an unknown input', () => {
        expect(resolve('gri')).toEqual({kind: 'unknown', suggestions: ['cmp/grid/README.md']});
        expect(resolve('')).toEqual({kind: 'unknown', suggestions: []});
    });
});

describe('DocTools', () => {
    const tools = new DocTools([react, core]);

    it('reads a section, an outline, and a whole doc', () => {
        const section = tools.read('grid', 'Sorting > Custom Comparators');
        expect(section.isError).toBeFalsy();
        expect(section.text).toMatch(
            /^\[cmp\/grid\/README\.md \| Grid Package > Sorting > Custom Comparators \| L\d+-\d+ \| ~\d+ tokens\]/
        );
        expect(section.structured).toMatchObject({id: 'cmp/grid/README.md', matchedAs: 'grid'});

        const outline = tools.read('cmp/grid/README.md', null, true);
        expect(outline.text).toContain('Outline of cmp/grid/README.md (Grid Package');
        expect(outline.text).toContain('  - Custom Comparators');

        const whole = tools.read('core:caching');
        expect(whole.structured).toMatchObject({
            id: 'core:docs/caching.md',
            library: 'io.xh:hoist-core'
        });
        expect(whole.text).toContain('A Cache holds computed values');
    });

    it('reports ambiguous and unknown sections and ids', () => {
        const ambiguous = tools.read('grid', 'Default Sort');
        expect(ambiguous.isError).toBe(true);
        expect(ambiguous.text).toContain('matches 2 sections');
        expect(ambiguous.text).toContain('"Sorting > Default Sort"');

        expect(tools.read('grid', 'nothing like it').text).toContain(
            'No section "nothing like it"'
        );
        expect(tools.read('no-such-doc').text).toMatch(/^Unknown document ID: "no-such-doc"\./);
    });

    it('searches across libraries, labelling other libraries', () => {
        const out = tools.search('cache cluster');
        expect(out.structured?.resultCount).toBeGreaterThan(0);
        expect(out.text).toContain('Caching > Cache [io.xh:hoist-core]');
        expect(out.text).toContain('id: core:docs/caching.md');
    });

    it('ranks heading matches first and caps sections per doc', () => {
        const results = react.docSearch.search('sort', null, 10);
        expect(results[0].entry.id).toBe('cmp/grid/README.md');
        expect(results.filter(r => r.entry.id === 'cmp/grid/README.md').length).toBeLessThanOrEqual(
            2
        );
        // Upgrade notes are down-weighted below the primary doc.
        const ids = results.map(r => r.entry.id);
        expect(ids.indexOf('cmp/grid/README.md')).toBeLessThan(
            ids.indexOf('docs/upgrade-notes/v85-upgrade-notes.md')
        );
    });

    it('filters by category and lists docs', () => {
        expect(
            react.docSearch
                .search('persistWith', 'concept')
                .every(r => r.entry.mcpCategory === 'concept')
        ).toBe(true);
        const list = new DocTools([react]).list('concept');
        expect(list.text).toContain('- docs/persistence.md: Persistence docs.');
        expect(list.structured?.totalCount).toBe(1);
    });

    it('returns each doc once for viewer search', () => {
        const ids = react.docSearch.searchDocs('grid sort').map(r => r.entry.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('SymbolTools', () => {
    const tools = new SymbolTools([react, core]);

    it('ranks the exact name first and folds a component with its factory and props', () => {
        const res = react.symbolSearch.search('Grid');
        expect(res.symbols[0].entry.name).toBe('Grid');
        expect(res.symbols[0]).toMatchObject({factory: 'grid', props: 'GridProps'});
        expect(tools.search('Grid').text).toContain(
            '1. [component] Grid / grid (@xh/hoist/cmp/grid)'
        );
    });

    it('hides internal code unless asked, and counts it', () => {
        const hidden = tools.search('GridLocalModel');
        expect(hidden.text).toContain(
            'Hidden exact match: GridLocalModel (cmp/grid/impl/GridLocalModel.ts) - internal (impl/) code'
        );
        const shown = react.symbolSearch.search('GridLocalModel', {includeInternal: true});
        expect(shown.symbols[0].entry.name).toBe('GridLocalModel');
    });

    it('finds members', () => {
        const res = react.symbolSearch.search('sortBy');
        expect(res.members[0].entry).toMatchObject({ownerName: 'GridModel', name: 'sortBy'});
    });

    it('describes a symbol with its member summary', () => {
        const out = tools.describe('GridModel');
        expect(out.text).toContain("Import: import {GridModel} from '@xh/hoist/cmp/grid';");
        expect(out.text).toContain('## Members (2 own, 1 inherited)');
        expect(out.text).toContain('### Inherited from HoistModel');
        expect(out.text).toContain('Full member details: hoist-get-members {name: "GridModel"}');
    });

    it('returns both declarations of a name in one file', () => {
        const out = tools.describe('FieldType');
        expect(out.text).toMatch(
            /^2 declarations of "FieldType" in data\/Field\.ts: const and type\./
        );
        expect(tools.describe('FieldType', null, 'type').text).toMatch(/^# FieldType \(type\)/);
    });

    it('lists members with filters', () => {
        const out = tools.members({name: 'GridModel', filter: 'sort'});
        expect(out.text).toContain('# GridModel Members matching "sort" (2 of 3)');
        expect(out.text).toContain('- sortBy: GridSorter[] = []');
        expect(out.text).toContain('      sorters: Sorts to apply.');
        expect(tools.members({name: 'Grid'}).text).toContain('"Grid" is a const');
    });

    it('describes Groovy symbols with a Java-style import', () => {
        const out = tools.describe('BaseService');
        expect(out.text).toContain('Import: import io.xh.hoist.BaseService');
        expect(tools.describe('NoSuchThing').isError).toBe(true);
    });
});

describe('IndexStore', () => {
    it('holds a bounded number of parsed indexes, dropping the least recently used', () => {
        const versions = Array.from({length: 14}, (_, i) => `${70 + i}.0.0`),
            store = new IndexStore(
                writeIndexDir(
                    Object.fromEntries(versions.map(v => [`react-${v}.json`, reactIndex(v)]))
                )
            ),
            first = store.get('react', '70.0.0');
        // Used again between loads, 70.0.0 stays, while 71.0.0 is the least recently used.
        const second = store.get('react', '71.0.0');
        versions.slice(2).forEach(v => {
            store.get('react', v);
            store.get('react', '70.0.0');
        });
        expect(store.get('react', '70.0.0')).toBe(first);
        expect(store.get('react', '71.0.0')).not.toBe(second);
        expect(store.get('react', '71.0.0').version).toBe('71.0.0');
    });

    it('takes the number of parsed indexes to hold from MAX_LOADED_INDEXES', () => {
        expect(loadConfig({}).maxLoadedIndexes).toBe(12);
        expect(loadConfig({MAX_LOADED_INDEXES: '30'}).maxLoadedIndexes).toBe(30);
        expect(loadConfig({MAX_LOADED_INDEXES: 'many'}).maxLoadedIndexes).toBe(12);

        const store = new IndexStore(
                writeIndexDir({
                    'react-89.0.0.json': reactIndex('89.0.0'),
                    'react-90.0.0.json': reactIndex('90.0.0')
                }),
                {maxLoaded: 1}
            ),
            first = store.get('react', '89.0.0');
        store.get('react', '90.0.0');
        expect(store.get('react', '89.0.0')).not.toBe(first);
    });

    it('orders versions, preferring a release over its snapshot', () => {
        const sorted = ['90.0.0', '90.0.0-SNAPSHOT', '89.1.0', '100.0.0', '89.10.0'].sort(
            compareVersions
        );
        expect(sorted).toEqual(['89.1.0', '89.10.0', '90.0.0-SNAPSHOT', '90.0.0', '100.0.0']);
    });

    it('serves the newest version by default, any version on request, and gzipped files', () => {
        const dir = writeIndexDir({
                'react-89.0.0.json': reactIndex('89.0.0'),
                'react-90.0.0-SNAPSHOT.json.gz': reactIndex('90.0.0-SNAPSHOT'),
                'core-40.0.json': coreIndex('40.0'),
                'not-an-index.txt': reactIndex()
            }),
            store = new IndexStore(dir);
        store.init();

        expect(store.libraryIds()).toEqual(['react', 'core']);
        expect(store.versions('react')).toEqual(['90.0.0-SNAPSHOT', '89.0.0']);
        expect(store.get('react').version).toBe('90.0.0-SNAPSHOT');
        expect(store.get('react', '89.0.0').version).toBe('89.0.0');
        expect(() => store.get('react', '1.0')).toThrow(NotFoundError);
        expect(() => store.get('nope')).toThrow(NotFoundError);
    });

    it('reloads a file that changed on disk', () => {
        const dir = writeIndexDir({'core-40.0.json': coreIndex('40.0')}),
            store = new IndexStore(dir);
        expect(store.get('core').docs.length).toBe(2);

        const updated = coreIndex('40.0'),
            path = join(dir, 'core-40.0.json');
        updated.docs.entries.pop();
        writeFileSync(path, JSON.stringify(updated));
        const later = new Date(Date.now() + 60_000);
        utimesSync(path, later, later);
        (store as unknown as {lastScan: number}).lastScan = 0;
        expect(store.get('core').docs.length).toBe(1);
    });

    it('rejects an unknown schema version', () => {
        expect(() => new LibraryIndex({...coreIndex(), schemaVersion: 2})).toThrow(
            /schemaVersion 2/
        );
    });
});
