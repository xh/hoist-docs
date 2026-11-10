import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

import {DocsCatalog, extractDocs} from '../src/docs/index.ts';
import {coreIndex, reactIndex} from './fixtures.ts';

const catalog = new DocsCatalog([
    extractDocs(coreIndex('44.0.0')),
    extractDocs(reactIndex('90.0.0'))
]);

describe('docs library', () => {
    it('answers registry, content and search in the docs API shapes', () => {
        const {entries, sources} = catalog.registry();
        expect(sources['hoist-react']).toEqual({
            label: 'Hoist React',
            categories: [{id: 'components', title: 'Components'}],
            version: '90.0.0',
            versions: ['90.0.0']
        });
        expect(entries).toContainEqual({
            id: 'docs/caching.md',
            source: 'hoist-core',
            title: 'Caching',
            category: 'concepts',
            description: 'Caching docs.',
            keywords: []
        });
        expect(catalog.content('hoist-core', 'docs/caching.md')).toContain('# Caching');

        const results = catalog.search('grid sort', 2);
        expect(results).toHaveLength(2);
        expect(results[0]).toMatchObject({source: 'hoist-react', id: 'cmp/grid/README.md'});
        expect(Object.keys(results[0]).sort()).toEqual([
            'id',
            'score',
            'section',
            'snippet',
            'source'
        ]);
        // Each doc once, under its best section. Both libraries have a docs/README.md.
        const hits = catalog.search('grid', 10).map(r => `${r.source}:${r.id}`);
        expect(new Set(hits).size).toBe(hits.length);
    });

    it('orders hoist-react first and reports missing docs as null', () => {
        expect(catalog.libraries.map(l => l.source)).toEqual(['hoist-react', 'hoist-core']);
        expect(catalog.content('hoist-react', 'nope.md')).toBeNull();
    });

    it('refuses a schema it does not know', () => {
        expect(() => new DocsCatalog([{...extractDocs(coreIndex()), schemaVersion: 2}])).toThrow(
            /Upgrade @xh\/hoist-docs/
        );
    });

    it('imports nothing from Node, so it bundles for the browser', () => {
        const seen = new Set<string>(),
            nodeImports: string[] = [];
        const walk = (file: string) => {
            if (seen.has(file)) return;
            seen.add(file);
            const src = readFileSync(file, 'utf8');
            for (const m of src.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm)) {
                const spec = m[1];
                if (spec.startsWith('node:')) nodeImports.push(`${file}: ${spec}`);
                else if (spec.startsWith('.')) walk(resolve(dirname(file), spec));
            }
        };
        walk(resolve(import.meta.dirname, '../src/docs/index.ts'));
        expect(nodeImports).toEqual([]);
        expect(seen.size).toBeGreaterThan(4);
    });
});
