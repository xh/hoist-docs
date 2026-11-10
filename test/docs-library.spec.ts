import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

import {loadConfig} from '../src/config.ts';
import {DocsApi} from '../src/docs-api.ts';
import {DocsCatalog, extractDocs} from '../src/docs/index.ts';
import {IndexStore} from '../src/IndexStore.ts';
import {coreIndex, reactIndex, writeIndexDir} from './fixtures.ts';

const catalog = new DocsCatalog([
    extractDocs(coreIndex('44.0.0')),
    extractDocs(reactIndex('90.0.0'))
]);

describe('docs library', () => {
    it('answers registry, content and search as the docs API does', () => {
        const store = new IndexStore(
                writeIndexDir({
                    'react-90.0.0.json': reactIndex('90.0.0'),
                    'core-44.0.0.json': coreIndex('44.0.0')
                })
            ),
            api = new DocsApi(store, loadConfig({}, 'test')),
            params = (q: Record<string, string>) => new URLSearchParams(q);

        expect(catalog.registry()).toEqual(api.registry(params({})));
        expect(catalog.content('hoist-core', 'docs/caching.md')).toEqual(
            api.content(params({source: 'hoist-core', docId: 'docs/caching.md'})).content
        );
        expect(catalog.search('grid sort', 5)).toEqual(
            api.search(params({query: 'grid sort', limit: '5'})).results
        );
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
