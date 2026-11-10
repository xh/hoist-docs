/**
 * Public, read-only docs API for docs viewers - Toolbox's desktop and mobile viewers in
 * particular. Keyed by source names `hoist-react` and `hoist-core`; each source's version can be
 * chosen with a request param named for the source (e.g. `hoist-react=86.2.0`), defaulting to the
 * newest loaded.
 */
import type {Config} from './config.ts';
import {NotFoundError, type IndexStore} from './IndexStore.ts';
import type {LibraryIndex} from './index/LibraryIndex.ts';
import {trackUsage} from './usage.ts';

const SOURCE_BY_LIBRARY: Record<string, string> = {react: 'hoist-react', core: 'hoist-core'},
    LABEL_BY_LIBRARY: Record<string, string> = {react: 'Hoist React', core: 'Hoist Core'};

type Json = Record<string, unknown>;

export class DocsApi {
    private readonly store: IndexStore;
    private readonly config: Config;

    constructor(store: IndexStore, config: Config) {
        this.store = store;
        this.config = config;
    }

    /** Doc registry of every library, with each library's categories and available versions. */
    registry(params: URLSearchParams): Json {
        const entries: Json[] = [],
            sources: Json = {};
        for (const lib of this.libraries(params)) {
            const source = sourceName(lib.id);
            sources[source] = {
                label: LABEL_BY_LIBRARY[lib.id] ?? lib.name,
                categories: lib.viewerCategories,
                version: lib.version,
                versions: this.store.versions(lib.id)
            };
            for (const d of lib.docs) {
                entries.push({
                    id: d.id,
                    source,
                    title: d.title,
                    category: d.viewerCategory,
                    description: d.description,
                    keywords: d.keywords
                });
            }
        }
        return {entries, sources};
    }

    /** Markdown of one doc. */
    content(params: URLSearchParams): Json {
        const source = params.get('source') ?? '',
            docId = params.get('docId') ?? '',
            lib = this.store.get(libraryId(source), params.get(source) || params.get('version')),
            entry = lib.docsById.get(docId);
        if (!entry) throw new NotFoundError(`Doc not found: ${source}:${docId}`);
        return {content: entry.markdown};
    }

    /**
     * Ranked docs matching a query, across every library - the same ranking the MCP tools use,
     * with each doc listed once under its best-matching section.
     */
    search(params: URLSearchParams, userAgent?: string): Json {
        const query = params.get('query') ?? '',
            limit = parseInt(params.get('limit') ?? '') || 25,
            start = Date.now(),
            results = this.libraries(params)
                .flatMap(lib =>
                    lib.docSearch.searchDocs(query, limit).map(r => ({
                        source: sourceName(lib.id),
                        id: r.entry.id,
                        score: r.score,
                        section: r.section.ref,
                        snippet: r.excerpt
                    }))
                )
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);

        const usage: Json = {
            resultCount: results.length,
            client: params.get('client') || userAgent
        };
        if (this.config.logQueries) usage.query = query;
        trackUsage({category: 'Docs', action: 'search', elapsedMs: Date.now() - start, ...usage});
        return {results};
    }

    /** The newest version of each library, or the version a request param names. */
    private libraries(params: URLSearchParams): LibraryIndex[] {
        return this.store.libraryIds().map(id => this.store.get(id, params.get(sourceName(id))));
    }
}

function sourceName(libId: string): string {
    return SOURCE_BY_LIBRARY[libId] ?? libId;
}

function libraryId(source: string): string {
    return Object.entries(SOURCE_BY_LIBRARY).find(([, s]) => s === source)?.[0] ?? source;
}
