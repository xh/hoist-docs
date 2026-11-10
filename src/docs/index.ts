/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * Browser-safe docs library: registry, content and ranked search over the docs of one or more
 * Hoist libraries, for docs viewers such as Toolbox's. Same ranking as the MCP tools, because it
 * is the same code. Imports nothing from Node, so it bundles for the browser.
 *
 * Input is a docs payload per library: the docs part of an index file, written by
 * `hoist-docs export-docs` (see {@link extractDocs}). Results keep the shapes of the former
 * `docs/*` HTTP API, which Toolbox's viewer already reads.
 */
import {DocEntry} from '../index/DocEntry.ts';
import {DocSearch} from '../index/DocSearch.ts';
import {SCHEMA_VERSION, type Category, type IndexFile, type LibraryInfo} from '../index/types.ts';

/** The docs part of an index file: everything a viewer needs, without the symbols. */
export interface DocsPayload {
    schemaVersion: number;
    library: LibraryInfo;
    docs: IndexFile['docs'];
}

export interface RegistryEntry {
    id: string;
    source: string;
    title: string;
    category: string;
    description: string;
    keywords: string[];
}

export interface SourceInfo {
    label: string;
    categories: Category[];
    version: string;
    versions: string[];
}

export interface DocsSearchResult {
    source: string;
    id: string;
    score: number;
    /** Ref of the best-matching section, to pass when reading. */
    section: string;
    snippet: string;
}

const SOURCE_BY_LIBRARY: Record<string, string> = {react: 'hoist-react', core: 'hoist-core'},
    LABEL_BY_LIBRARY: Record<string, string> = {react: 'Hoist React', core: 'Hoist Core'};

/** The docs part of a full index file. */
export function extractDocs(index: IndexFile): DocsPayload {
    return {schemaVersion: index.schemaVersion, library: index.library, docs: index.docs};
}

/** One library's docs, searchable. */
export class LibraryDocs {
    readonly library: LibraryInfo;
    /** Source name viewers use for this library: `hoist-react`, `hoist-core`, or the library id. */
    readonly source: string;
    readonly categories: Category[];
    readonly docs: DocEntry[];
    readonly docsById: Map<string, DocEntry>;
    private _search: DocSearch | null = null;

    constructor(payload: DocsPayload) {
        if (payload.schemaVersion !== SCHEMA_VERSION) {
            throw new Error(
                `Unsupported docs schemaVersion ${payload.schemaVersion} - expected ${SCHEMA_VERSION}. Upgrade @xh/hoist-docs.`
            );
        }
        this.library = payload.library;
        this.source = SOURCE_BY_LIBRARY[payload.library.id] ?? payload.library.id;
        this.categories = payload.docs.viewerCategories ?? [];
        this.docs = payload.docs.entries.map(e => new DocEntry(e));
        this.docsById = new Map(this.docs.map(d => [d.id, d]));
    }

    /** Search index, built on first use. */
    get docSearch(): DocSearch {
        return (this._search ??= new DocSearch(this));
    }
}

/** The docs of several libraries, hoist-react first. */
export class DocsCatalog {
    readonly libraries: LibraryDocs[];

    constructor(payloads: DocsPayload[]) {
        const order = (id: string) => ['react', 'core'].indexOf(id) + 1 || 99;
        this.libraries = payloads
            .map(p => new LibraryDocs(p))
            .sort((a, b) => order(a.library.id) - order(b.library.id));
    }

    /** Every doc, with each source's categories and version. */
    registry(): {entries: RegistryEntry[]; sources: Record<string, SourceInfo>} {
        const entries: RegistryEntry[] = [],
            sources: Record<string, SourceInfo> = {};
        for (const lib of this.libraries) {
            sources[lib.source] = {
                label: LABEL_BY_LIBRARY[lib.library.id] ?? lib.library.name,
                categories: lib.categories,
                version: lib.library.version,
                versions: [lib.library.version]
            };
            for (const d of lib.docs) {
                entries.push({
                    id: d.id,
                    source: lib.source,
                    title: d.title,
                    category: d.viewerCategory,
                    description: d.description,
                    keywords: d.keywords
                });
            }
        }
        return {entries, sources};
    }

    /** Markdown of one doc, or null if the source has no such doc. */
    content(source: string, docId: string): string | null {
        return this.librarySource(source)?.docsById.get(docId)?.markdown ?? null;
    }

    /** Ranked docs across every library, each once under its best-matching section. */
    search(query: string, limit: number = 25): DocsSearchResult[] {
        return this.libraries
            .flatMap(lib =>
                lib.docSearch.searchDocs(query, limit).map(r => ({
                    source: lib.source,
                    id: r.entry.id,
                    score: r.score,
                    section: r.section.ref,
                    snippet: r.excerpt
                }))
            )
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    private librarySource(source: string): LibraryDocs | undefined {
        return this.libraries.find(l => l.source === source);
    }
}
