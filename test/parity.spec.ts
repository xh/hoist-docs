/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * Checks that search ranks exactly as hoist-react's own search did before it moved here.
 *
 * `test/fixtures/parity` holds hoist-react's results for every query in its golden-set specs, and
 * `test/fixtures/indexes` the index they were computed against, both generated at hoist-react
 * commit 788f56b3d (the last with the old search code). To check against another index and
 * fixture set built from one commit, point TEST_INDEX_DIR at a directory holding the index.
 */
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {LibraryIndex} from '../src/index/LibraryIndex.ts';

interface DocCase {
    query: string;
    results: Array<{id: string; section: string; score: number}>;
}

interface SymbolCase {
    query: string;
    includeInternal: boolean;
    symbols: Array<{
        name: string;
        filePath: string;
        score: number;
        factory: string | null;
        props: string | null;
    }>;
    members: Array<{owner: string; name: string; score: number}>;
    symbolTotal: number;
    memberTotal: number;
    hiddenSymbols: number;
    hiddenMembers: number;
}

const dir =
        process.env.TEST_INDEX_DIR || fileURLToPath(new URL('fixtures/indexes', import.meta.url)),
    fixture = <T>(name: string): T =>
        JSON.parse(readFileSync(new URL(`fixtures/parity/${name}`, import.meta.url), 'utf8')) as T;

describe('search parity with hoist-react', () => {
    const file = readdirSync(dir).find(f => /^react-.*\.json(\.gz)?$/.test(f)),
        react = LibraryIndex.load(join(dir, file!));

    it('doc search returns the same sections, in order, with the same scores', () => {
        for (const c of fixture<DocCase[]>('doc-search.json')) {
            const actual = react.docSearch.search(c.query, null, 10);
            expect(
                actual.map(r => `${r.entry.id} > ${r.section.ref}`),
                c.query
            ).toEqual(c.results.map(r => `${r.id} > ${r.section}`));
            actual.forEach((r, i) =>
                expect(r.score, `${c.query} #${i}`).toBeCloseTo(c.results[i].score, 6)
            );
        }
    });

    it('symbol search returns the same symbols and members, in order, with the same scores', () => {
        for (const c of fixture<SymbolCase[]>('symbol-search.json')) {
            const label = `${c.query} (includeInternal: ${c.includeInternal})`,
                actual = react.symbolSearch.search(c.query, {
                    limit: 20,
                    includeInternal: c.includeInternal
                });
            expect(
                actual.symbols.map(
                    h =>
                        `${h.entry.name}|${h.entry.filePath}|${h.factory ?? null}|${h.props ?? null}`
                ),
                label
            ).toEqual(c.symbols.map(s => `${s.name}|${s.filePath}|${s.factory}|${s.props}`));
            expect(
                actual.members.map(h => `${h.entry.ownerName}.${h.entry.name}`),
                label
            ).toEqual(c.members.map(m => `${m.owner}.${m.name}`));
            actual.symbols.forEach((h, i) =>
                expect(h.score, `${label} symbol #${i}`).toBeCloseTo(c.symbols[i].score, 6)
            );
            actual.members.forEach((h, i) =>
                expect(h.score, `${label} member #${i}`).toBeCloseTo(c.members[i].score, 6)
            );
            expect(
                [
                    actual.symbolTotal,
                    actual.memberTotal,
                    actual.hiddenSymbols,
                    actual.hiddenMembers
                ],
                label
            ).toEqual([c.symbolTotal, c.memberTotal, c.hiddenSymbols, c.hiddenMembers]);
        }
    });
});
