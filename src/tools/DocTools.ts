/**
 * Documentation tools over one or more loaded libraries: search, list, and read. Output text
 * keeps the shapes agents saw from the stdio MCP servers this service replaces.
 *
 * Doc ids from libraries other than hoist-react are qualified with the library id
 * (`core:docs/caching.md`), since hoist-react and hoist-core both have e.g. `docs/README.md`.
 * Unqualified ids resolve against hoist-react first.
 */
import {DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, type DocSearchResult} from '../index/DocSearch.ts';
import type {DocResolution} from '../index/DocIdResolver.ts';
import {
    estimateTokens,
    formatTokens,
    getSectionContent,
    getSubsections,
    resolveSection,
    splitLines,
    type DocSection,
    type SectionResolveResult
} from '../index/doc-sections.ts';
import type {LibraryIndex} from '../index/LibraryIndex.ts';
import type {ToolOutput} from './types.ts';

/** Full reads above this size carry a note pointing to `section` and `outline`. */
const LARGE_DOC_TOKENS = 3000;

export function qualifiedId(lib: LibraryIndex, docId: string): string {
    return lib.id === 'react' ? docId : `${lib.id}:${docId}`;
}

export class DocTools {
    /** Libraries in scope for this call, hoist-react first. */
    readonly libraries: LibraryIndex[];

    constructor(libraries: LibraryIndex[]) {
        this.libraries = libraries;
    }

    //------------------------
    // Search
    //------------------------
    search(query: string, category?: string | null, limit?: number | null): ToolOutput {
        const max = Math.min(Math.max(limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT),
            results = this.libraries
                .flatMap(lib => lib.docSearch.search(query, category, max).map(r => ({lib, r})))
                .sort((a, b) => b.r.score - a.r.score)
                .slice(0, max);

        let text: string;
        if (!results.length) {
            text = `No sections matched "${query}". Try two or three keywords, using the names the docs use (e.g. "persistWith", "XH.confirm").`;
        } else {
            const lines = [
                `${results.length} section${results.length > 1 ? 's' : ''} matched "${query}":`,
                ''
            ];
            results.forEach(({lib, r}, i) => {
                const s = r.section;
                lines.push(`${i + 1}. ${s.breadcrumb}${this.libraryLabel(lib)}`);
                lines.push(
                    `   id: ${qualifiedId(lib, r.entry.id)} | section: "${s.ref}" | L${s.startLine}-${s.extentEndLine} | ${formatTokens(s.tokens)}`
                );
                lines.push(`   ${r.excerpt}`);
                lines.push('');
            });
            text =
                lines.join('\n').trimEnd() +
                "\n\nRead a result with hoist-read-doc {id, section}, or list a doc's sections with {id, outline: true}.";
        }

        return {
            text,
            structured: {
                query,
                resultCount: results.length,
                results: results.map(({lib, r}) => searchResultJson(lib, r))
            }
        };
    }

    /** Tags hits from libraries other than hoist-react when several are in scope. */
    private libraryLabel(lib: LibraryIndex): string {
        return this.libraries.length > 1 && lib.id !== 'react' ? ` [${lib.name}]` : '';
    }

    //------------------------
    // List
    //------------------------
    list(category?: string | null): ToolOutput {
        const cat = category || 'all',
            lines: string[] = [],
            entries: Array<Record<string, unknown>> = [];
        for (const lib of this.libraries) {
            const inScope = lib.docs.filter(d => cat === 'all' || d.mcpCategory === cat),
                header = lib.id === 'react' ? 'Hoist Documentation' : `${lib.name} ${lib.version}`;
            lines.push(`${header} (${inScope.length} documents):\n`);
            for (const c of lib.mcpCategories) {
                const inCat = inScope.filter(d => d.mcpCategory === c.id);
                if (!inCat.length) continue;
                lines.push(`## ${c.title} (${inCat.length} doc${inCat.length > 1 ? 's' : ''})`);
                inCat.forEach(d => lines.push(`- ${qualifiedId(lib, d.id)}: ${d.description}`));
                lines.push('');
            }
            inScope.forEach(d =>
                entries.push({
                    id: qualifiedId(lib, d.id),
                    title: d.title,
                    library: lib.name,
                    category: d.mcpCategory,
                    description: d.description
                })
            );
        }

        const categories = new Map<string, string>();
        this.libraries
            .flatMap(l => l.mcpCategories)
            .forEach(c => {
                if (!categories.has(c.id)) categories.set(c.id, c.title);
            });

        return {
            text:
                lines.join('\n') +
                'Read a doc with hoist-read-doc {id} - add section: "<heading>" for one section, or outline: true for its headings. The hoist://docs/{id} resource also serves full docs.',
            structured: {
                categoryFilter: cat,
                totalCount: entries.length,
                entries,
                categories: [...categories].map(([id, title]) => ({id, title})),
                libraries: this.libraries.map(l => ({
                    name: l.name,
                    version: l.version,
                    docCount: l.docs.length
                }))
            }
        };
    }

    //------------------------
    // Read
    //------------------------
    /** Resolve an id - qualified (`core:...`) or not - against the libraries in scope. */
    locate(id: string): {lib: LibraryIndex; resolution: DocResolution} | null {
        const raw = (id ?? '').trim(),
            colon = raw.indexOf(':');
        if (colon > 0) {
            const lib = this.libraries.find(l => l.id === raw.slice(0, colon));
            if (lib) return {lib, resolution: lib.resolver.resolve(raw.slice(colon + 1))};
        }
        let firstMiss: {lib: LibraryIndex; resolution: DocResolution} | null = null;
        for (const lib of this.libraries) {
            const resolution = lib.resolver.resolve(raw);
            if (resolution.kind !== 'unknown') return {lib, resolution};
            firstMiss ??= {lib, resolution};
        }
        return firstMiss;
    }

    read(id: string, section?: string | null, outline: boolean = false): ToolOutput {
        const located = this.locate(id);
        if (!located || located.resolution.kind === 'unknown') {
            const suggestions =
                located?.resolution.kind === 'unknown'
                    ? located.resolution.suggestions.map(s => qualifiedId(located.lib, s))
                    : [];
            const tail = suggestions.length
                ? `Did you mean one of: ${suggestions.map(s => `"${s}"`).join(', ')}?`
                : 'Call hoist-list-docs to see valid IDs, or hoist-search-docs to find one by keyword.';
            return {text: `Unknown document ID: "${id}". ${tail}`, isError: true};
        }

        const {lib} = located,
            {entry} = located.resolution,
            content = entry.markdown,
            canonical = qualifiedId(lib, entry.id),
            base: Record<string, unknown> = {
                id: canonical,
                title: entry.title,
                category: entry.mcpCategory,
                library: lib.name
            };
        if (canonical !== id) base.matchedAs = id;

        if (!section && !outline) {
            const tokens = estimateTokens(content),
                note =
                    tokens > LARGE_DOC_TOKENS
                        ? `This doc is ${formatTokens(tokens)}. Pass outline: true to list its sections, or section: "<heading>" to read one.\n\n`
                        : '';
            return {text: note + content, structured: {...base, tokens, content}};
        }

        const {sections} = entry;
        let target: DocSection | null = null;
        if (section) {
            const found = resolveSection(entry, sections, section);
            if (found.kind !== 'found') {
                return {
                    text: formatSectionMiss(canonical, sections, section, found),
                    isError: true
                };
            }
            target = found.section;
        }

        if (outline) {
            const outlined = target ? getSubsections(sections, target) : sections,
                lines = [
                    `Outline of ${canonical} (${entry.title}, ${formatTokens(estimateTokens(content))}, ${splitLines(content).length} lines):`,
                    ''
                ];
            outlined.forEach(s =>
                lines.push(
                    `${s.level === 3 ? '  ' : ''}- ${s.heading}  L${s.startLine}-${s.extentEndLine}  ${formatTokens(s.tokens)}`
                )
            );
            lines.push(
                '',
                'Read one with section: "<heading>". Use "<parent> > <heading>" when a heading repeats.'
            );
            return {
                text: lines.join('\n'),
                structured: {
                    ...base,
                    tokens: target ? target.tokens : estimateTokens(content),
                    outline: outlined.map(s => ({
                        section: s.ref,
                        heading: s.heading,
                        level: s.level,
                        startLine: s.startLine,
                        endLine: s.extentEndLine,
                        tokens: s.tokens
                    }))
                }
            };
        }

        const t = target!,
            body = getSectionContent(content, t);
        return {
            text: `[${canonical} | ${t.breadcrumb} | L${t.startLine}-${t.extentEndLine} | ${formatTokens(t.tokens)}]\n\n${body}`,
            structured: {
                ...base,
                tokens: t.tokens,
                content: body,
                section: {
                    section: t.ref,
                    breadcrumb: t.breadcrumb,
                    startLine: t.startLine,
                    endLine: t.extentEndLine
                }
            }
        };
    }
}

//------------------------
// Implementation
//------------------------
function searchResultJson(lib: LibraryIndex, r: DocSearchResult): Record<string, unknown> {
    return {
        id: qualifiedId(lib, r.entry.id),
        library: lib.name,
        section: r.section.ref,
        breadcrumb: r.section.breadcrumb,
        category: r.entry.mcpCategory,
        startLine: r.section.startLine,
        endLine: r.section.extentEndLine,
        tokens: r.section.tokens,
        score: Math.round(r.score * 10) / 10,
        excerpt: r.excerpt
    };
}

function formatSectionMiss(
    docId: string,
    sections: DocSection[],
    input: string,
    result: Exclude<SectionResolveResult, {kind: 'found'}>
): string {
    const lines: string[] = [];
    if (result.kind === 'ambiguous') {
        lines.push(
            `Section "${input}" matches ${result.candidates.length} sections in ${docId}. Pass the full path of one:`
        );
        result.candidates.forEach(c => lines.push(`- "${c.ref}"`));
    } else {
        lines.push(`No section "${input}" in ${docId}.`);
        if (result.suggestions.length) {
            lines.push(
                `Did you mean one of: ${result.suggestions.map(s => `"${s.ref}"`).join(', ')}?`
            );
        }
        lines.push('', 'Sections:');
        sections.forEach(s => lines.push(`${s.level === 3 ? '  ' : ''}- ${s.heading}`));
    }
    return lines.join('\n');
}
