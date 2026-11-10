/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {readdirSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';

import {LibraryIndex} from './index/LibraryIndex.ts';
import {log} from './log.ts';

/** Libraries in display order. hoist-react comes first, so its doc ids win when unqualified. */
const LIBRARY_ORDER = ['react', 'core'];

const FILE_RE = /^([a-z][a-z0-9-]*)-(.+?)\.json(\.gz)?$/;

/** How long a directory scan is trusted before the next request rescans. */
const RESCAN_MS = 5_000;

/** Thrown for a library or version with no index file. */
export class NotFoundError extends Error {}

interface IndexFileRef {
    path: string;
    mtimeMs: number;
}

/** One index file named explicitly, rather than found by scanning a directory. */
export interface IndexFileSpec {
    libraryId: string;
    version: string;
    path: string;
}

/**
 * The index files the tool serves, from one of two sources:
 *
 * - **A directory** of `<libraryId>-<version>.json[.gz]` files (see docs/index-schema.md), for
 *   HTTP deployments and development. It may hold several versions of each library.
 * - **Explicit files**, for the local tool: one per library, for the project's own versions.
 *
 * Each file is parsed on first use and held in memory. Sources are rechecked at most every few
 * seconds, and a file that changed on disk is reloaded, so freshly built indexes are picked up
 * without a restart.
 */
export class IndexStore {
    /** The directory scanned, or null for explicit files. */
    readonly dir: string | null;
    private readonly specs: IndexFileSpec[] | null;
    /** libraryId -> version -> file */
    private files = new Map<string, Map<string, IndexFileRef>>();
    private loaded = new Map<string, {index: LibraryIndex; mtimeMs: number}>();
    private lastScan = 0;
    private missingDirWarned = false;

    constructor(source: string | IndexFileSpec[]) {
        if (typeof source === 'string') {
            this.dir = resolve(source);
            this.specs = null;
        } else {
            this.dir = null;
            this.specs = source.map(s => ({...s, path: resolve(s.path)}));
        }
    }

    /** Scan the directory and load the newest version of every library. */
    init(): void {
        this.scan();
        this.latest();
    }

    /** Library ids with at least one index file, in display order. */
    libraryIds(): string[] {
        this.maybeRescan();
        const rank = (id: string) => {
            const i = LIBRARY_ORDER.indexOf(id);
            return i < 0 ? 99 : i;
        };
        return [...this.files.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    }

    /** Available versions of a library, newest first. */
    versions(libraryId: string): string[] {
        this.maybeRescan();
        return [...(this.files.get(libraryId)?.keys() ?? [])].sort(compareVersions).reverse();
    }

    /** The index for a library at a version - the newest when no version is given. */
    get(libraryId: string, version?: string | null): LibraryIndex {
        this.maybeRescan();
        const byVersion = this.files.get(libraryId);
        if (!byVersion) {
            throw new NotFoundError(
                `No index loaded for library '${libraryId}'. Available: ${this.libraryIds().join(', ')}`
            );
        }
        const v = version || this.versions(libraryId)[0],
            file = byVersion.get(v);
        if (!file) {
            throw new NotFoundError(
                `No index for ${libraryId} version '${v}'. Available: ${this.versions(libraryId).join(', ')}`
            );
        }

        const key = `${libraryId}@${v}`,
            cached = this.loaded.get(key);
        if (cached && cached.mtimeMs === file.mtimeMs) return cached.index;

        const start = Date.now(),
            index = LibraryIndex.load(file.path);
        this.loaded.set(key, {index, mtimeMs: file.mtimeMs});
        log.info('Loaded index', {file: file.path, elapsedMs: Date.now() - start});
        return index;
    }

    /** Path of the index file for a library version - the newest when no version is given. */
    filePath(libraryId: string, version?: string | null): string {
        this.maybeRescan();
        const v = version || this.versions(libraryId)[0],
            file = this.files.get(libraryId)?.get(v);
        if (!file) throw new NotFoundError(`No index for ${libraryId} version '${v}'`);
        return file.path;
    }

    /** The newest index of every library, in display order. */
    latest(): LibraryIndex[] {
        return this.libraryIds().map(id => this.get(id));
    }

    //------------------------
    // Implementation
    //------------------------
    private maybeRescan(): void {
        if (Date.now() - this.lastScan > RESCAN_MS) this.scan();
    }

    private scan(): void {
        this.lastScan = Date.now();
        if (this.specs) {
            const ret = new Map<string, Map<string, IndexFileRef>>();
            for (const {libraryId, version, path} of this.specs) {
                let byVersion = ret.get(libraryId);
                if (!byVersion) ret.set(libraryId, (byVersion = new Map()));
                byVersion.set(version, {path, mtimeMs: statSync(path).mtimeMs});
            }
            this.files = ret;
            return;
        }

        const dir = this.dir!,
            ret = new Map<string, Map<string, IndexFileRef>>();
        let names: string[];
        try {
            names = readdirSync(dir);
        } catch {
            if (!this.missingDirWarned) {
                log.warn('Index directory not found - no docs will be served', {dir});
                this.missingDirWarned = true;
            }
            this.files = ret;
            return;
        }

        for (const name of names) {
            const m = FILE_RE.exec(name);
            if (!m) continue;
            const [, lib, version] = m,
                path = join(dir, name);
            let byVersion = ret.get(lib);
            if (!byVersion) ret.set(lib, (byVersion = new Map()));
            // Prefer the uncompressed file when both exist.
            if (!byVersion.has(version) || !name.endsWith('.gz')) {
                byVersion.set(version, {path, mtimeMs: statSync(path).mtimeMs});
            }
        }

        const summary = (m: Map<string, Map<string, IndexFileRef>>) =>
            JSON.stringify([...m].map(([k, v]) => [k, [...v.keys()].sort(compareVersions)]));
        if (summary(ret) !== summary(this.files)) {
            log.info('Index files found', {
                dir,
                libraries: Object.fromEntries(
                    [...ret].map(([k, v]) => [k, [...v.keys()].sort(compareVersions)])
                )
            });
        }
        this.missingDirWarned = false;
        this.files = ret;
    }
}

/** Orders versions numerically by segment; a SNAPSHOT sorts before its release. */
export function compareVersions(a: string, b: string): number {
    const pa = parseVersion(a),
        pb = parseVersion(b);
    for (let i = 0; i < Math.max(pa.nums.length, pb.nums.length); i++) {
        const c = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
        if (c) return c;
    }
    if (pa.snapshot !== pb.snapshot) return pa.snapshot ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
}

function parseVersion(v: string): {nums: number[]; snapshot: boolean} {
    return {
        snapshot: /snapshot/i.test(v),
        nums: v
            .replace(/-SNAPSHOT.*/i, '')
            .split(/[.-]/)
            .map(s => (/^\d+$/.test(s) ? parseInt(s) : 0))
    };
}
