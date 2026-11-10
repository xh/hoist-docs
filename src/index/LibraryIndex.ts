/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

import {libraryDef} from '../libraries.ts';
import {DocEntry} from './DocEntry.ts';
import {DocIdResolver} from './DocIdResolver.ts';
import {DocSearch} from './DocSearch.ts';
import {SymbolSearch} from './SymbolSearch.ts';
import {
    SCHEMA_VERSION,
    type Category,
    type IndexFile,
    type MemberIndexEntry,
    type SymbolEntry,
    type SymbolKind
} from './types.ts';

/**
 * One library version's index file, loaded into memory: its docs, symbols with their members,
 * and the member index. Search indexes over these are built on first use. See
 * docs/index-schema.md for the file format.
 */
export {DocEntry};

export class LibraryIndex {
    /** Library id used in tool arguments: `react`, `core`, or a companion id. */
    readonly id: string;
    /** Package name, e.g. `@xh/hoist`. */
    readonly name: string;
    readonly version: string;
    readonly language: string;
    readonly gitSha: string | null;
    readonly builtAt: string;
    readonly description: string | null;
    /** Display name from the built-in library table (`Hoist Chat Kit`), else null. */
    readonly label: string | null;
    readonly instructions: string | null;

    readonly mcpCategories: Category[];
    readonly viewerCategories: Category[];
    readonly docs: DocEntry[];
    readonly docsById: Map<string, DocEntry>;

    readonly symbols: SymbolEntry[];
    readonly memberIndex: MemberIndexEntry[];
    readonly resolver: DocIdResolver;

    /** Symbols keyed by lowercase name, in file order. */
    private readonly symbolsByKey = new Map<string, SymbolEntry[]>();
    private _docSearch: DocSearch | null = null;
    private _symbolSearch: SymbolSearch | null = null;

    /**
     * @param opts.trusted - false to drop the index's agent instructions, for an index from outside
     *     the `@xh` scope. Default true.
     */
    constructor(json: IndexFile, opts: {trusted?: boolean} = {}) {
        if (json.schemaVersion !== SCHEMA_VERSION) {
            throw new Error(
                `Unsupported index schemaVersion ${json.schemaVersion} - expected ${SCHEMA_VERSION}`
            );
        }
        const lib = json.library;
        this.id = lib.id;
        this.name = lib.name;
        this.version = lib.version;
        this.language = lib.language;
        this.gitSha = lib.gitSha ?? null;
        this.builtAt = lib.builtAt;
        this.description = lib.description ?? null;
        this.label = libraryDef(lib.id)?.label ?? null;
        this.instructions = opts.trusted === false ? null : (lib.instructions ?? null);

        this.mcpCategories = json.docs.mcpCategories ?? [];
        this.viewerCategories = json.docs.viewerCategories ?? [];
        this.docs = json.docs.entries.map(e => new DocEntry(e));
        this.docsById = new Map(this.docs.map(d => [d.id, d]));

        this.symbols = json.symbols ?? [];
        this.memberIndex = json.memberIndex ?? [];
        for (const s of this.symbols) {
            const key = s.name.toLowerCase();
            let list = this.symbolsByKey.get(key);
            if (!list) this.symbolsByKey.set(key, (list = []));
            list.push(s);
        }
        this.resolver = new DocIdResolver(this.docs);
    }

    /** Read an index file, gzipped when its name ends in `.gz`. */
    static load(path: string, opts: {trusted?: boolean} = {}): LibraryIndex {
        return new LibraryIndex(LibraryIndex.readJson(path), opts);
    }

    /** An index file's raw contents, gzipped when its name ends in `.gz`. */
    static readJson(path: string): IndexFile {
        let buf = readFileSync(path);
        if (path.endsWith('.gz')) buf = gunzipSync(buf);
        return JSON.parse(buf.toString('utf8')) as IndexFile;
    }

    get isTypeScript(): boolean {
        return this.language === 'typescript';
    }

    get docSearch(): DocSearch {
        return (this._docSearch ??= new DocSearch(this));
    }

    get symbolSearch(): SymbolSearch {
        return (this._symbolSearch ??= new SymbolSearch(this));
    }

    //------------------------
    // Symbol lookup
    //------------------------
    /** Exact-name lookup, optionally narrowed by file and kind. Prefers exported symbols. */
    findSymbol(name: string, filePath?: string | null, kind?: string | null): SymbolEntry | null {
        const exact = this.named(name).filter(s => !kind || s.kind === kind);
        if (!exact.length) return null;
        if (filePath) {
            const rel = normalizePath(filePath);
            return exact.find(s => s.filePath === rel) ?? null;
        }
        return exact.find(s => s.isExported) ?? exact[0];
    }

    /** Every declaration of a name in the file it resolves to, primary first. */
    findDeclarations(
        name: string,
        filePath?: string | null,
        kind?: SymbolKind | null
    ): SymbolEntry[] {
        const primary = this.findSymbol(name, filePath, kind);
        if (!primary) return [];
        if (kind) return [primary];
        return [
            primary,
            ...this.named(name).filter(s => s !== primary && s.filePath === primary.filePath)
        ];
    }

    /** Other exported symbols with this name, in other files. */
    findAlternates(name: string, selectedFilePath: string): SymbolEntry[] {
        return this.named(name).filter(
            s =>
                s.isExported &&
                s.filePath !== selectedFilePath &&
                !s.sourcePackage.startsWith('dynamics')
        );
    }

    /** For a Props interface, its component consts; for a component const, its Props interface. */
    findCompanions(entry: SymbolEntry): SymbolEntry[] {
        const {name} = entry;
        if (entry.kind === 'interface' && name.endsWith('Props')) {
            const base = name.slice(0, -'Props'.length);
            if (!base) return [];
            const camel = base[0].toLowerCase() + base.slice(1);
            return [...new Set([base, camel])].flatMap(n =>
                this.named(n).filter(s => s.kind === 'const' && s.filePath === entry.filePath)
            );
        }
        if (entry.kind === 'const') {
            const props = name[0].toUpperCase() + name.slice(1) + 'Props';
            return this.named(props).filter(
                s => s.kind === 'interface' && s.filePath === entry.filePath
            );
        }
        return [];
    }

    /** Symbols with exactly this name, in file order. */
    private named(name: string): SymbolEntry[] {
        return (this.symbolsByKey.get(name.toLowerCase()) ?? []).filter(s => s.name === name);
    }
}

function normalizePath(p: string): string {
    return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}
