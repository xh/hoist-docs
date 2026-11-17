/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {log} from '../log.ts';
import {IndexCache, RECHECK_MS} from './cache.ts';
import type {Registry} from './registry.ts';
import {readFromTgz} from './tar.ts';

/**
 * Pulls the index out of a published npm package, where a TypeScript library ships it (declared by
 * `hoistDocs.index` in its `package.json`), into the local cache. For when the package is not
 * installed: a gateway serving any release, or a library checkout serving another library's newest
 * snapshot. An installed package's index is read in place (see `installed.ts`).
 */
export class NpmSource {
    private readonly registry: Registry;
    private readonly cache: IndexCache;
    private readonly now: () => number;

    constructor(registry: Registry, cache: IndexCache = new IndexCache(), now = Date.now) {
        this.registry = registry;
        this.cache = cache;
        this.now = now;
    }

    /** Local path of the index shipped in `version` of `pkg`, fetching it if needed. */
    async resolve(pkg: string, version: string): Promise<string> {
        const name = `${slug(pkg)}-${version}.json.gz`;
        if (this.cache.has(name)) return this.cache.path(name);

        const tgz = await this.registry.pack(pkg, version),
            pkgJson = readFromTgz(tgz, 'package/package.json'),
            indexPath = pkgJson && JSON.parse(pkgJson.toString('utf8')).hoistDocs?.index,
            index = indexPath && readFromTgz(tgz, `package/${indexPath.replace(/^\.\//, '')}`);
        if (!index) {
            throw new Error(
                `${pkg}@${version} ships no Hoist Docs index - releases from before Hoist Docs shipped indexes carry none. Upgrade, or serve an index directory (INDEX_DIR).`
            );
        }
        const path = this.cache.write(name, index);
        log.info('Fetched index', {pkg, version});
        return path;
    }

    /**
     * The version and index a dist-tag (`latest`, `next`) points at, rechecked at most daily, or
     * every `recheckMs`. When the registry cannot be reached, the last one fetched is used.
     */
    async resolveTag(
        pkg: string,
        tag: string,
        recheckMs: number = RECHECK_MS
    ): Promise<{version: string; path: string}> {
        const key = `npm:${pkg}#${tag}`,
            cached = this.cache.resolution(key),
            cachedVersion = () => cached!.file.slice(slug(pkg).length + 1, -'.json.gz'.length);
        if (cached && this.now() - cached.checkedAt < recheckMs) {
            return {version: cachedVersion(), path: this.cache.path(cached.file)};
        }
        try {
            const version = await this.registry.distTag(pkg, tag);
            if (!version) throw new Error(`${pkg} has no '${tag}' dist-tag`);
            const path = await this.resolve(pkg, version);
            this.cache.setResolution(key, `${slug(pkg)}-${version}.json.gz`, this.now());
            return {version, path};
        } catch (e) {
            if (!cached) throw e;
            log.warn('npm registry unreachable - using cached index', {pkg, tag, error: String(e)});
            return {version: cachedVersion(), path: this.cache.path(cached.file)};
        }
    }
}

/** `@xh/hoist` to `xh-hoist`, for file names. */
function slug(pkg: string): string {
    return pkg.replace(/^@/, '').replace(/\//g, '-');
}
