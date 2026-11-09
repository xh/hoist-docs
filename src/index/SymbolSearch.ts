/**
 * Ranked search over one library's symbols and the members of its indexed classes and
 * interfaces, with MiniSearch (BM25+).
 *
 * Symbols are indexed on name, kind, package, own member names, and doc summary and body; members
 * on owner, name, type, and doc summary and body. Exact name matches are boosted, TypeScript
 * symbols without a package barrel are down-weighted, and a component, its element factory, and
 * its Props interface fold into one hit. Code under impl/, admin/, inspector/, and dynamics/ is
 * hidden unless asked for, but counted so callers can say how much was hidden.
 */
import MiniSearch, {type SearchOptions} from 'minisearch';

import type {LibraryIndex} from './LibraryIndex.ts';
import {
    createTermProcessor,
    firstSentence,
    isRedundantCompoundMatch,
    queryTerms,
    rankByCoverage,
    splitSummary,
    tokenize
} from './search-text.ts';
import type {MemberIndexEntry, SymbolEntry} from './types.ts';

export const DEFAULT_SEARCH_LIMIT = 8,
    MAX_SEARCH_LIMIT = 20,
    SUMMARY_CHARS = 160,
    MEMBER_SUMMARY_CHARS = 160;

//------------------------
// Tuning
//------------------------
const SYMBOL_BOOST = {name: 4, kind: 0.3, package: 0.5, members: 1, summary: 1.5, body: 0.4},
    MEMBER_BOOST = {owner: 2, name: 4, type: 0.3, summary: 1.5, body: 0.4},
    /** Multiplier when the query spells out a hit's whole name. */
    EXACT_NAME_BOOST = 2.5,
    /** Further multiplier for a member hit whose owner the query also names. */
    OWNER_NAMED_BOOST = 1.3,
    /** Weight of `@xh/hoist/kit/` re-exports of third-party libraries. */
    KIT_WEIGHT = 0.5,
    /** Weight of TypeScript symbols that no package barrel re-exports. */
    FILE_IMPORT_WEIGHT = 0.125,
    /** Weight of members whose docs are inherited, so the declaring type ranks first. */
    INHERITED_DOC_WEIGHT = 0.98,
    INTERNAL_TOP_DIRS = new Set(['admin', 'inspector', 'dynamics']),
    INTERNAL_SEGMENT = 'impl';

export interface SymbolHit {
    entry: SymbolEntry;
    score: number;
    summary: string;
    hasMembers: boolean;
    /** Element factory folded into this component hit. */
    factory?: string;
    /** Props interface folded into this component hit. */
    props?: string;
}

export interface MemberHit {
    entry: MemberIndexEntry;
    score: number;
    summary: string;
    /** Barrel import path of the member's owner, if any. */
    importPath: string | null;
}

export interface SymbolSearchOptions {
    kind?: string | null;
    exported?: boolean | null;
    includeInternal?: boolean | null;
    limit?: number | null;
}

export interface SymbolSearchResults {
    query: string;
    symbols: SymbolHit[];
    members: MemberHit[];
    symbolTotal: number;
    memberTotal: number;
    hiddenSymbols: number;
    hiddenMembers: number;
    /** Internal symbols the query names exactly, hidden because includeInternal was off. */
    hiddenExact: SymbolEntry[];
}

interface IndexedSymbol {
    id: number;
    name: string;
    kind: string;
    package: string;
    members: string;
    summary: string;
    body: string;
}

interface IndexedMember {
    id: number;
    owner: string;
    name: string;
    type: string;
    summary: string;
    body: string;
}

interface ScoredSymbol {
    entry: SymbolEntry;
    score: number;
    factory?: string;
    props?: string;
}

export class SymbolSearch {
    private readonly library: LibraryIndex;
    private readonly symbolIndex: MiniSearch<IndexedSymbol>;
    private readonly memberIndex: MiniSearch<IndexedMember>;
    private readonly symbolHeads: Map<string, string>;
    private readonly memberHeads: Map<string, string>;
    /** Barrel import path of each symbol, keyed by `name|filePath`. */
    private readonly ownerImportPaths = new Map<string, string | null>();

    constructor(library: LibraryIndex) {
        this.library = library;

        const symbolProcessor = createTermProcessor();
        this.symbolHeads = symbolProcessor.compoundHeads;
        this.symbolIndex = new MiniSearch<IndexedSymbol>({
            fields: ['name', 'kind', 'package', 'members', 'summary', 'body'],
            tokenize,
            processTerm: symbolProcessor.processTerm
        });
        this.symbolIndex.addAll(
            library.symbols.map((s, id) => {
                const {summary, rest} = splitSummary(s.doc ?? '');
                this.ownerImportPaths.set(`${s.name}|${s.filePath}`, s.importPath ?? null);
                return {
                    id,
                    name: s.name,
                    kind: s.kind,
                    package: s.sourcePackage ?? '',
                    members: s.memberNames ?? '',
                    summary,
                    body: rest
                };
            })
        );

        const memberProcessor = createTermProcessor();
        this.memberHeads = memberProcessor.compoundHeads;
        this.memberIndex = new MiniSearch<IndexedMember>({
            fields: ['owner', 'name', 'type', 'summary', 'body'],
            tokenize,
            processTerm: memberProcessor.processTerm
        });
        this.memberIndex.addAll(
            library.memberIndex.map((m, id) => {
                const {summary, rest} = splitSummary(m.doc ?? '');
                return {
                    id,
                    owner: m.ownerName,
                    name: m.name,
                    type: m.type ?? '',
                    summary,
                    body: rest
                };
            })
        );
    }

    search(query: string, opts: SymbolSearchOptions = {}): SymbolSearchResults {
        const terms = queryTerms(query),
            ret: SymbolSearchResults = {
                query,
                symbols: [],
                members: [],
                symbolTotal: 0,
                memberTotal: 0,
                hiddenSymbols: 0,
                hiddenMembers: 0,
                hiddenExact: []
            };
        if (!terms.length) return ret;

        const {library} = this,
            limit = Math.min(Math.max(opts.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT),
            includeInternal = opts.includeInternal === true,
            exportedOnly = opts.exported ?? !includeInternal,
            querySet = new Set(terms),
            rawTokens = tokenize(query),
            // Whole names the query spells out: each raw token, and all tokens run together.
            named = new Set([
                ...rawTokens.map(t => t.toLowerCase()),
                rawTokens.join('').toLowerCase()
            ]),
            q = terms.join(' '),
            baseOpts = (heads: Map<string, string>): SearchOptions => ({
                combineWith: 'OR',
                prefix: term => term.length >= 3,
                // No fuzzy matching: API names are exact, camelCase parts and prefixes already
                // give recall for near misses, and fuzzy pulled "current" hits into "currency".
                fuzzy: false,
                tokenize: s => s.split(' '),
                processTerm: t => t,
                boostDocument: (_id, term) =>
                    isRedundantCompoundMatch(heads, term, terms, querySet) ? 0 : 1
            });

        //------------------------
        // Symbols
        //------------------------
        // Internal hits are ranked with the rest, then set aside and counted unless requested.
        const allSymbolHits: ScoredSymbol[] = rankByCoverage(
            this.symbolIndex.search(q, {
                ...baseOpts(this.symbolHeads),
                boost: SYMBOL_BOOST,
                filter: hit => {
                    const e = library.symbols[hit.id];
                    return (!opts.kind || e.kind === opts.kind) && (!exportedOnly || e.isExported);
                }
            }),
            terms.length
        ).map(({hit, score}) => {
            const entry = library.symbols[hit.id],
                exact = named.has(entry.name.toLowerCase()),
                weight = this.symbolWeight(entry.importPath, entry.isPromiseExtension === true);
            return {entry, score: exact ? hit.score * EXACT_NAME_BOOST * weight : score * weight};
        });

        const symbolHits = includeInternal
            ? allSymbolHits
            : allSymbolHits.filter(h => !this.isInternal(h.entry.filePath));
        if (!includeInternal) {
            ret.hiddenExact = allSymbolHits
                .filter(
                    h => this.isInternal(h.entry.filePath) && named.has(h.entry.name.toLowerCase())
                )
                .map(h => h.entry);
        }
        const merged = mergeComponentHits(
            symbolHits.sort(
                (a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length
            )
        );

        //------------------------
        // Members
        //------------------------
        // *Props members are searched only when the query names the component or its Props.
        const allMemberHits = rankByCoverage(
            this.memberIndex.search(q, {
                ...baseOpts(this.memberHeads),
                boost: MEMBER_BOOST,
                filter: hit => {
                    const owner = library.memberIndex[hit.id].ownerName;
                    if (!owner.endsWith('Props')) return true;
                    const lower = owner.toLowerCase();
                    return named.has(lower) || named.has(lower.slice(0, -'props'.length));
                }
            }),
            terms.length
        ).map(({hit, score}) => {
            const entry = library.memberIndex[hit.id],
                importPath =
                    this.ownerImportPaths.get(`${entry.ownerName}|${entry.filePath}`) ?? null,
                exact = named.has(entry.name.toLowerCase());
            let s =
                (exact ? hit.score * EXACT_NAME_BOOST : score) *
                this.symbolWeight(importPath, entry.ownerName === 'Promise');
            if (exact && named.has(entry.ownerName.toLowerCase())) s *= OWNER_NAMED_BOOST;
            if (entry.docInheritedFrom) s *= INHERITED_DOC_WEIGHT;
            return {entry, score: s, importPath};
        });

        const visibleMemberHits = includeInternal
                ? allMemberHits
                : allMemberHits.filter(h => !this.isInternal(h.entry.filePath)),
            seen = new Set<string>(),
            memberHits = visibleMemberHits
                .filter(({entry: e}) => {
                    const key = `${e.ownerName}.${e.name}:${e.type}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                })
                .sort(
                    (a, b) =>
                        b.score - a.score ||
                        a.entry.ownerName.length - b.entry.ownerName.length ||
                        a.entry.name.length - b.entry.name.length
                );

        ret.symbols = merged.slice(0, limit).map(h => ({
            ...h,
            summary: firstSentence(h.entry.doc ?? '', SUMMARY_CHARS),
            hasMembers: ['class', 'interface', 'trait'].includes(h.entry.kind)
        }));
        ret.members = memberHits.slice(0, limit).map(h => ({
            ...h,
            summary: firstSentence(h.entry.doc ?? '', MEMBER_SUMMARY_CHARS)
        }));
        ret.symbolTotal = merged.length;
        ret.memberTotal = memberHits.length;
        ret.hiddenSymbols = allSymbolHits.length - symbolHits.length;
        ret.hiddenMembers = allMemberHits.length - visibleMemberHits.length;
        return ret;
    }

    /** The internal directory a file sits in, or null. TypeScript libraries only. */
    internalDir(filePath: string): string | null {
        if (!this.library.isTypeScript) return null;
        const dirs = filePath.split('/').filter(Boolean).slice(0, -1);
        if (dirs.length && INTERNAL_TOP_DIRS.has(dirs[0])) return dirs[0];
        return dirs.includes(INTERNAL_SEGMENT) ? INTERNAL_SEGMENT : null;
    }

    private isInternal(filePath: string): boolean {
        return this.internalDir(filePath) != null;
    }

    private symbolWeight(importPath: string | null | undefined, noImport: boolean): number {
        if (!this.library.isTypeScript) return 1;
        if (!importPath) return noImport ? 1 : FILE_IMPORT_WEIGHT;
        return importPath.startsWith('@xh/hoist/kit/') ? KIT_WEIGHT : 1;
    }
}

//------------------------
// Implementation
//------------------------
type ComponentRole = 'component' | 'factory' | 'props';

function componentRole(e: SymbolEntry): ComponentRole | null {
    if (e.kind === 'const') return /^[A-Z]/.test(e.name) ? 'component' : 'factory';
    if (e.kind === 'interface' && e.name.endsWith('Props') && e.name.length > 5) return 'props';
    return null;
}

/**
 * Fold a component, its element factory and its Props interface into one hit, at the position
 * of the best-ranked of them. The component itself is preferred as the hit's entry.
 */
function mergeComponentHits(hits: ScoredSymbol[]): ScoredSymbol[] {
    const groups = new Map<string, ScoredSymbol>(),
        ret: ScoredSymbol[] = [];
    for (const hit of hits) {
        const e = hit.entry,
            role = componentRole(e);
        if (!role) {
            ret.push(hit);
            continue;
        }

        const base = role === 'props' ? e.name.slice(0, -'Props'.length) : e.name,
            key = `${e.filePath}|${base[0].toLowerCase()}${base.slice(1)}`,
            group = groups.get(key);
        if (!group) {
            const created = {...hit};
            groups.set(key, created);
            ret.push(created);
            continue;
        }

        const current = componentRole(group.entry);
        if (role === current) continue;
        if (role === 'props') group.props = e.name;
        else if (role === 'factory') group.factory = e.name;
        if (role === 'component' || (role === 'factory' && current === 'props')) {
            if (current === 'props') group.props = group.entry.name;
            else if (current === 'factory') group.factory = group.entry.name;
            group.entry = e;
        }
    }
    return ret;
}
