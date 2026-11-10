/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

/** How long a resolved moving version (a snapshot, a dist-tag) is trusted before rechecking. */
export const RECHECK_MS = 24 * 60 * 60 * 1000;

/** What a moving version last resolved to: a cached index file, and when that was checked. */
export interface Resolution {
    file: string;
    checkedAt: number;
}

/**
 * Where fetched indexes are kept: index files, plus `resolved.json` recording what each moving
 * version (a Maven snapshot, an npm dist-tag) last resolved to.
 */
export class IndexCache {
    readonly dir: string;

    constructor(dir: string = defaultCacheDir()) {
        this.dir = dir;
    }

    /** Path for a cached index file. */
    path(name: string): string {
        return join(this.dir, name);
    }

    has(name: string): boolean {
        return existsSync(this.path(name));
    }

    write(name: string, data: Buffer): string {
        mkdirSync(this.dir, {recursive: true});
        const path = this.path(name);
        writeFileSync(path, data);
        return path;
    }

    /** The last resolution of `key`, if its file is still cached. */
    resolution(key: string): Resolution | null {
        const r = this.readResolutions()[key];
        return r && this.has(r.file) ? r : null;
    }

    setResolution(key: string, file: string, checkedAt: number): void {
        const all = this.readResolutions();
        all[key] = {file, checkedAt};
        mkdirSync(this.dir, {recursive: true});
        writeFileSync(join(this.dir, 'resolved.json'), JSON.stringify(all, null, 2));
    }

    private readResolutions(): Record<string, Resolution> {
        try {
            return JSON.parse(readFileSync(join(this.dir, 'resolved.json'), 'utf8'));
        } catch {
            return {};
        }
    }
}

/** `HOIST_DOCS_CACHE`, else the platform's user cache directory. */
export function defaultCacheDir(env: Record<string, string | undefined> = process.env): string {
    if (env.HOIST_DOCS_CACHE) return env.HOIST_DOCS_CACHE;
    if (process.platform === 'win32' && env.LOCALAPPDATA) {
        return join(env.LOCALAPPDATA, 'hoist-docs', 'cache');
    }
    return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'hoist-docs');
}
