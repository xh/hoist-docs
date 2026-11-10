/**
 * Tolerant doc id resolution for one library's docs. Accepts the shortened or slightly-off ids
 * agents naturally try (`grid`, `cmp/grid`, `v85`) and resolves them when the mapping is
 * unambiguous, failing closed with suggestions otherwise.
 *
 * Tiers, in order: exact id, trivial normalization (`./`, leading and doubled slashes), case,
 * aliases (generated from paths plus each entry's declared `aliases`), then structural suffix
 * completion (`X.md`, `X/README.md`, `docs/X.md`, ...). Generated aliases that would map to more
 * than one doc are dropped, and suffix completion matching more than one doc resolves nothing.
 */
import type {DocEntry} from './DocEntry.ts';

export type DocResolution =
    | {kind: 'exact'; entry: DocEntry}
    | {kind: 'normalized'; entry: DocEntry; matchedAs: string}
    | {kind: 'unknown'; suggestions: string[]};

export class DocIdResolver {
    private readonly entries: DocEntry[];
    private readonly byId: Map<string, DocEntry>;
    private readonly aliases: Map<string, string>;

    constructor(entries: DocEntry[]) {
        this.entries = entries;
        this.byId = new Map(entries.map(e => [e.id, e]));
        this.aliases = buildAliasMap(entries);
    }

    resolve(input: string): DocResolution {
        const raw = (input ?? '').trim();
        if (!raw) return {kind: 'unknown', suggestions: []};

        const exact = this.byId.get(raw);
        if (exact) return {kind: 'exact', entry: exact};

        const cleaned = raw
            .replace(/^\.\//, '')
            .replace(/^\/+/, '')
            .replace(/\/+/g, '/')
            .replace(/\/+$/, '');
        const normalized = (entry: DocEntry): DocResolution => ({
            kind: 'normalized',
            entry,
            matchedAs: raw
        });

        if (cleaned !== raw) {
            const hit = this.byId.get(cleaned);
            if (hit) return normalized(hit);
        }

        const lower = cleaned.toLowerCase(),
            caseHit = this.entries.find(e => e.id.toLowerCase() === lower);
        if (caseHit) return normalized(caseHit);

        const aliasTarget = this.aliases.get(lower),
            aliasHit = aliasTarget ? this.byId.get(aliasTarget) : null;
        if (aliasHit) return normalized(aliasHit);

        const matches = new Set<DocEntry>();
        for (const candidate of suffixCandidates(cleaned)) {
            const hit = this.byId.get(candidate);
            if (hit) matches.add(hit);
        }
        if (matches.size === 1) return normalized([...matches][0]);

        return {kind: 'unknown', suggestions: this.suggest(raw)};
    }

    /** Up to 5 ids similar to the input, ranked by where it matches. */
    private suggest(input: string): string[] {
        const lower = input.toLowerCase();
        if (!lower) return [];

        const scored: Array<{id: string; score: number}> = [];
        for (const {id} of this.entries) {
            const idLower = id.toLowerCase(),
                segs = idLower
                    .replace(/\.md$/, '')
                    .replace(/\/readme$/, '')
                    .split('/')
                    .filter(Boolean),
                lastSeg = segs.at(-1) ?? '';
            let score = 0;
            if (idLower.includes(lower)) score += 10;
            if (lastSeg.includes(lower)) score += 5;
            if (segs.some(s => s.startsWith(lower))) score += 3;
            if (score > 0) scored.push({id, score});
        }

        scored.sort((a, b) => b.score - a.score || a.id.length - b.id.length);
        return scored.slice(0, 5).map(s => s.id);
    }
}

//------------------------
// Implementation
//------------------------
function suffixCandidates(input: string): string[] {
    if (input.endsWith('.md')) {
        return [`${input.slice(0, -3)}/README.md`, `docs/${input}`];
    }
    if (input.endsWith('/README')) return [`${input}.md`];

    const ret = [
            `${input}.md`,
            `${input}/README.md`,
            `docs/${input}.md`,
            `docs/${input}/README.md`
        ],
        version = /^v(\d+)(?:-upgrade-notes)?$/i.exec(input);
    if (version) ret.push(`docs/upgrade-notes/v${version[1]}-upgrade-notes.md`);
    return ret;
}

/**
 * Lowercased alias to canonical id. Generated aliases claimed by more than one doc are dropped.
 * Declared aliases then override them, except one that collides with another doc's id, and the
 * first declaration of an alias wins.
 */
function buildAliasMap(entries: DocEntry[]): Map<string, string> {
    const candidates = new Map<string, Set<string>>();
    for (const e of entries) {
        const canonical = e.id.toLowerCase();
        for (const alias of pathAliasesFor(e.id)) {
            const lower = alias.toLowerCase();
            if (lower === canonical) continue;
            let ids = candidates.get(lower);
            if (!ids) candidates.set(lower, (ids = new Set()));
            ids.add(e.id);
        }
    }

    const ret = new Map<string, string>();
    for (const [key, ids] of candidates) {
        if (ids.size === 1) ret.set(key, [...ids][0]);
    }

    const canonicalIds = new Set(entries.map(e => e.id.toLowerCase())),
        claimed = new Set<string>();
    for (const e of entries) {
        for (const alias of e.aliases) {
            const lower = alias.toLowerCase();
            if (canonicalIds.has(lower) && lower !== e.id.toLowerCase()) continue;
            if (claimed.has(lower)) continue;
            claimed.add(lower);
            ret.set(lower, e.id);
        }
    }
    return ret;
}

/**
 * Shortenings of a doc path, e.g. `cmp/grid/README.md` gives `cmp/grid/README`, `cmp/grid` and
 * `grid`; `docs/upgrade-notes/v85-upgrade-notes.md` also gives `v85`.
 */
function pathAliasesFor(path: string): string[] {
    const ret = new Set<string>(),
        noMd = path.endsWith('.md') ? path.slice(0, -3) : path,
        noReadme = noMd.endsWith('/README') ? noMd.slice(0, -'/README'.length) : noMd;
    ret.add(noMd);
    ret.add(noReadme);

    const lastSeg = noReadme.split('/').filter(Boolean).at(-1);
    if (lastSeg) ret.add(lastSeg);

    if (noMd.startsWith('docs/')) {
        const stripped = noMd.slice('docs/'.length);
        ret.add(stripped);
        const docsLast = stripped.split('/').filter(Boolean).at(-1);
        if (docsLast) ret.add(docsLast);
    }

    const version = /\/v(\d+)-upgrade-notes\.md$/.exec(path);
    if (version) ret.add(`v${version[1]}`);
    return [...ret];
}
