/**
 * Section-level ranked search over one library's docs.
 *
 * Every doc is split into sections (see `doc-sections.ts`) and indexed with MiniSearch (BM25+).
 * Each section is indexed on two fields: its heading breadcrumb (`Doc title > H2 > H3`, boosted)
 * and its own body text. A doc's `title`, `description`, and `keywords` act as a doc-level boost
 * for terms they contain.
 *
 * Text processing (camelCase splitting, stop words, stemming) and the ranking helpers are shared
 * with symbol search - see `search-text.ts`. Queries use prefix matching and light fuzziness,
 * combined with OR and re-ranked by the share of query terms each section matches.
 */
import MiniSearch, {type SearchOptions} from 'minisearch';

import {LINK_DEF_RE, stripLinks, type DocSection} from './doc-sections.ts';
import type {DocEntry, LibraryIndex} from './LibraryIndex.ts';
import {
    createTermProcessor,
    isRedundantCompoundMatch,
    queryTerms,
    rankByCoverage,
    tokenize
} from './search-text.ts';

/** A single ranked section. */
export interface DocSearchResult {
    entry: DocEntry;
    section: DocSection;
    /** BM25+ relevance score. Comparable only within a single result set. */
    score: number;
    /** Leading text of the section, trimmed to a sentence boundary. */
    excerpt: string;
}

export const DEFAULT_SEARCH_LIMIT = 5,
    MAX_SEARCH_LIMIT = 10;

//------------------------
// Tuning
//------------------------
/** At most this many sections from one doc per MCP result set. */
const MAX_PER_DOC = 2;

/** Target excerpt length in characters (~90 tokens). */
const EXCERPT_CHARS = 360;

/** Field boosts. The breadcrumb is short and highly descriptive. */
const FIELD_BOOST = {heading: 3, body: 1};

/** Multiplier for a term that also appears in the doc's registry metadata. */
const DOC_META_BOOST = 1.3;

/**
 * Per-doc score multipliers. Upgrade notes and the doc index mention nearly every API but are
 * rarely the best answer to a how-to query, so they rank below the primary docs.
 */
function docWeight(entry: DocEntry): number {
    if (entry.id.startsWith('docs/upgrade-notes/')) return 0.5;
    // The old MCP server's own README documents tooling, not app development.
    if (entry.id === 'mcp/README.md') return 0.5;
    if (entry.mcpCategory === 'index') return 0.6;
    return 1;
}

interface IndexedSection {
    id: number;
    /** The section's breadcrumb, plus any `####` headings in its body. */
    heading: string;
    body: string;
}

export class DocSearch {
    private readonly miniSearch: MiniSearch<IndexedSection>;
    /** Indexed sections by MiniSearch document id. */
    private readonly sections: Array<{section: DocSection; entry: DocEntry}> = [];
    /** Processed terms from each doc's title, description, and keywords. */
    private readonly metaTerms = new Map<string, Set<string>>();
    private readonly weights = new Map<string, number>();
    /** Indexed compound terms (`showfeedbackdialog`) mapped to their leading part (`show`). */
    private readonly compoundHeads: Map<string, string>;

    constructor(library: LibraryIndex) {
        const {processTerm, compoundHeads} = createTermProcessor(),
            docs: IndexedSection[] = [];
        this.compoundHeads = compoundHeads;
        this.miniSearch = new MiniSearch<IndexedSection>({
            fields: ['heading', 'body'],
            tokenize,
            processTerm
        });

        for (const entry of library.docs) {
            this.weights.set(entry.id, docWeight(entry));
            this.metaTerms.set(
                entry.id,
                new Set(queryTerms([entry.title, entry.description, ...entry.keywords].join(' ')))
            );

            for (const section of entry.sections) {
                const body = indexableBody(section.body);
                // Skip sections with no text of their own (e.g. a `##` that only groups `###`s) -
                // their children carry the parent heading in their breadcrumbs.
                if (body.replace(/[^\p{L}\p{N}]/gu, '').length < 20) continue;

                const id = this.sections.length;
                this.sections.push({section, entry});
                docs.push({
                    id,
                    heading: [section.breadcrumb, ...subHeadings(body)].join(' '),
                    body
                });
            }
        }
        this.miniSearch.addAll(docs);
    }

    /** Ranked sections, as the MCP tools return them: at most 10, and two per doc. */
    search(query: string, category?: string | null, limit?: number | null): DocSearchResult[] {
        const max = Math.min(Math.max(limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
        return this.rank(query, category, max, MAX_PER_DOC);
    }

    /**
     * Ranked docs for docs viewers: each doc once, represented by its best-matching section.
     * Uses the same ranking as {@link search}.
     */
    searchDocs(query: string, limit: number = 25): DocSearchResult[] {
        return this.rank(query, null, Math.max(limit, 1), 1);
    }

    private rank(
        query: string,
        category: string | null | undefined,
        max: number,
        maxPerDoc: number
    ): DocSearchResult[] {
        const terms = queryTerms(query);
        if (!terms.length) return [];

        const cat = category && category !== 'all' ? category : null,
            querySet = new Set(terms),
            opts: SearchOptions = {
                boost: FIELD_BOOST,
                prefix: term => term.length >= 3,
                fuzzy: term => (term.length >= 6 ? 0.2 : false),
                maxFuzzy: 2,
                combineWith: 'OR',
                tokenize: s => s.split(' '),
                processTerm: t => t,
                boostDocument: (id, term) => {
                    if (isRedundantCompoundMatch(this.compoundHeads, term, terms, querySet)) {
                        return 0;
                    }
                    const docId = this.sections[id].entry.id;
                    return (
                        this.weights.get(docId)! *
                        (this.metaTerms.get(docId)?.has(term) ? DOC_META_BOOST : 1)
                    );
                },
                filter: cat ? hit => this.sections[hit.id].entry.mcpCategory === cat : undefined
            },
            ranked = rankByCoverage(this.miniSearch.search(terms.join(' '), opts), terms.length);

        const ret: DocSearchResult[] = [],
            perDoc = new Map<string, number>();
        for (const {hit, score} of ranked) {
            if (ret.length >= max) break;
            const {section, entry} = this.sections[hit.id],
                count = perDoc.get(entry.id) ?? 0;
            if (count >= maxPerDoc) continue;
            perDoc.set(entry.id, count + 1);
            ret.push({entry, section, score, excerpt: makeExcerpt(section.body)});
        }
        return ret;
    }
}

//------------------------
// Text processing
//------------------------
const TOC_ROW_RE = /^\s*\|\s*\[[^\]]+\]\(#[^)]*\)\s*\|/,
    TABLE_RULE_RE = /^\s*\|?[\s:|-]+\|?\s*$/,
    FENCE_RE = /^\s*(```|~~~)/,
    SUBHEADING_RE = /^#{4,6}\s+(.+)$/gm;

/** Section body with table-of-contents rows removed - they match every query and answer none. */
function indexableBody(body: string): string {
    return body
        .split('\n')
        .filter(line => !TOC_ROW_RE.test(line))
        .join('\n');
}

/** `####`-and-deeper headings within a body, indexed with the (boosted) heading field. */
function subHeadings(body: string): string[] {
    return [...body.matchAll(SUBHEADING_RE)].map(m => m[1]);
}

/**
 * Leading text of a section, trimmed to about {@link EXCERPT_CHARS} at a sentence boundary.
 * Blank lines, TOC rows, table rules, and link definitions are dropped and whitespace collapsed.
 * Reading stops at the first code block once there is enough prose to describe the section -
 * code is included only when the section leads with it.
 */
export function makeExcerpt(body: string): string {
    const kept: string[] = [];
    let inFence = false,
        length = 0;
    for (const raw of body.split('\n')) {
        const line = raw.trim();
        if (FENCE_RE.test(line)) {
            if (!inFence && length >= EXCERPT_CHARS / 3) break;
            inFence = !inFence;
            continue;
        }
        if (!line || TOC_ROW_RE.test(line) || TABLE_RULE_RE.test(line) || LINK_DEF_RE.test(line)) {
            continue;
        }

        kept.push(stripLinks(line.replace(/^#{1,6}\s+/, '')));
        length += line.length;
        if (length > EXCERPT_CHARS) break;
    }

    const text = kept.join(' ').replace(/\s+/g, ' ');
    if (text.length <= EXCERPT_CHARS) return text;

    const cut = text.slice(0, EXCERPT_CHARS),
        sentenceEnds = [...cut.matchAll(/[.!?:](?=\s)/g)],
        lastSentence = sentenceEnds.at(-1)?.index ?? -1;
    if (lastSentence >= EXCERPT_CHARS / 2) return cut.slice(0, lastSentence + 1);

    return cut.slice(0, cut.lastIndexOf(' ')) + '...';
}
