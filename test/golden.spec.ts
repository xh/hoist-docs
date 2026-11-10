/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * Golden-set retrieval checks, one set per library, run against the checked-in indexes in
 * `test/fixtures/indexes`. Mirrors the specs hoist-react kept with its old search code:
 *
 * - top-3 hit rate at or above {@link MIN_HIT_RATE}, for doc search and for symbol search
 * - a default search renders under a token ceiling for every golden query - a guard against
 *   regressions to multi-thousand-token dumps, not a target
 *
 * Set VERBOSE=1 to print every query's top 3. Misses are printed whenever a library has any.
 */
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

import {describe, expect, it} from 'vitest';

import type {DocSearchResult} from '../src/index/DocSearch.ts';
import {estimateTokens} from '../src/index/doc-sections.ts';
import {LibraryIndex} from '../src/index/LibraryIndex.ts';
import type {SymbolSearchResults} from '../src/index/SymbolSearch.ts';
import {DocTools} from '../src/tools/DocTools.ts';
import {SymbolTools} from '../src/tools/SymbolTools.ts';
import {CHAT_KIT_DOC_CASES, CHAT_KIT_SYMBOL_CASES} from './golden/chat-kit-cases.ts';
import {CORE_DOC_CASES, CORE_SYMBOL_CASES} from './golden/core-cases.ts';
import {REACT_DOC_CASES, REACT_SYMBOL_CASES} from './golden/react-cases.ts';
import type {DocCase, SymbolCase, Target} from './golden/types.ts';

const MIN_HIT_RATE = 0.85,
    MAX_DOC_SEARCH_TOKENS = 800,
    MAX_SYMBOL_SEARCH_TOKENS = 1200;

const INDEX_DIR = fileURLToPath(new URL('fixtures/indexes', import.meta.url));

function loadIndex(libraryId: string): LibraryIndex {
    const file = readdirSync(INDEX_DIR).find(f => f.startsWith(`${libraryId}-`));
    return LibraryIndex.load(join(INDEX_DIR, file!));
}

const SETS = [
    {lib: loadIndex('react'), docCases: REACT_DOC_CASES, symbolCases: REACT_SYMBOL_CASES},
    {lib: loadIndex('core'), docCases: CORE_DOC_CASES, symbolCases: CORE_SYMBOL_CASES},
    {lib: loadIndex('chat-kit'), docCases: CHAT_KIT_DOC_CASES, symbolCases: CHAT_KIT_SYMBOL_CASES}
];

//------------------------
// Matching
//------------------------
function norm(s: string): string {
    return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function docMatches(r: DocSearchResult, t: Target): boolean {
    return (
        r.entry.id === t.doc &&
        (t.section == null || norm(r.section.ref).startsWith(norm(t.section)))
    );
}

function symbolHitNames(r: SymbolSearchResults): string[] {
    return [
        ...r.symbols.slice(0, 3).flatMap(h => [h.entry.name, h.factory, h.props]),
        ...r.members.slice(0, 3).map(h => `${h.entry.ownerName}.${h.entry.name}`)
    ].filter((n): n is string => !!n);
}

function symbolMatches(names: string[], expected: string[]): boolean {
    return expected.some(e =>
        e.startsWith('*.') ? names.some(n => n.endsWith(e.slice(1))) : names.includes(e)
    );
}

//------------------------
// Evaluation
//------------------------
interface Outcome {
    hits: number;
    total: number;
    misses: string[];
    maxTokens: number;
    maxTokensQuery: string;
}

function evalDocs(lib: LibraryIndex, cases: DocCase[]): Outcome {
    const tools = new DocTools([lib]),
        ret: Outcome = {hits: 0, total: cases.length, misses: [], maxTokens: 0, maxTokensQuery: ''};
    for (const c of cases) {
        const top3 = lib.docSearch.search(c.query).slice(0, 3),
            hit = top3.some(r => c.expect.some(t => docMatches(r, t))),
            tokens = estimateTokens(tools.search(c.query).text),
            got = top3.map((r, i) => `      ${i + 1}. ${r.entry.id} > ${r.section.ref}`);
        if (tokens > ret.maxTokens)
            Object.assign(ret, {maxTokens: tokens, maxTokensQuery: c.query});
        if (hit) ret.hits++;
        else {
            const want = c.expect
                .map(t => (t.section ? `${t.doc} > ${t.section}` : t.doc))
                .join(' | ');
            ret.misses.push(
                [`  "${c.query}" (${c.source})`, `      expected: ${want}`, ...got].join('\n')
            );
        }
        if (process.env.VERBOSE)
            console.log(`${hit ? 'HIT ' : 'MISS'} "${c.query}"\n${got.join('\n')}`);
    }
    return ret;
}

function evalSymbols(lib: LibraryIndex, cases: SymbolCase[]): Outcome {
    const tools = new SymbolTools([lib]),
        ret: Outcome = {hits: 0, total: cases.length, misses: [], maxTokens: 0, maxTokensQuery: ''};
    for (const c of cases) {
        const names = symbolHitNames(lib.symbolSearch.search(c.query)),
            hit = symbolMatches(names, c.expect),
            tokens = estimateTokens(tools.search(c.query).text);
        if (tokens > ret.maxTokens)
            Object.assign(ret, {maxTokens: tokens, maxTokensQuery: c.query});
        if (hit) ret.hits++;
        else {
            ret.misses.push(
                [
                    `  "${c.query}" (${c.source})`,
                    `      expected: ${c.expect.join(' | ')}`,
                    `      got: ${names.join(', ') || '-'}`
                ].join('\n')
            );
        }
        if (process.env.VERBOSE)
            console.log(`${hit ? 'HIT ' : 'MISS'} "${c.query}" -> ${names.join(', ')}`);
    }
    return ret;
}

function report(label: string, o: Outcome): string {
    const rate = ((o.hits / o.total) * 100).toFixed(1),
        summary = `${label}: ${o.hits}/${o.total} top-3 hits (${rate}%), largest search ~${o.maxTokens} tokens ("${o.maxTokensQuery}")`;
    return o.misses.length ? `${summary}\nMisses:\n${o.misses.join('\n')}` : summary;
}

//------------------------
// Specs
//------------------------
describe.each(SETS)('golden set: $lib.name $lib.version', ({lib, docCases, symbolCases}) => {
    it('doc search finds the expected section in the top 3', () => {
        const o = evalDocs(lib, docCases),
            text = report(`${lib.id} doc search`, o);
        console.log(text);
        expect(o.hits / o.total, text).toBeGreaterThanOrEqual(MIN_HIT_RATE);
        expect(o.maxTokens, text).toBeLessThan(MAX_DOC_SEARCH_TOKENS);
    });

    it('symbol search finds the expected symbol or member in the top 3', () => {
        const o = evalSymbols(lib, symbolCases),
            text = report(`${lib.id} symbol search`, o);
        console.log(text);
        expect(o.hits / o.total, text).toBeGreaterThanOrEqual(MIN_HIT_RATE);
        expect(o.maxTokens, text).toBeLessThan(MAX_SYMBOL_SEARCH_TOKENS);
    });
});
