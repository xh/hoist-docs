/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

import {log} from '../log.ts';
import {DEVELOP_TAG, INDEX_FILE_IN_PACKAGE, INDEX_PACKAGES, pickRevision} from './packages.ts';
import {isSnapshot} from './project.ts';
import type {Registry} from './registry.ts';
import {readFromTgz} from './tar.ts';

/** How long a resolved package version is trusted before the registry is checked again. */
const RECHECK_MS = 24 * 60 * 60 * 1000;

interface Resolution {
    /** Package version chosen, e.g. `90.0.0-r2`. */
    pkgVersion: string;
    checkedAt: number;
}

/**
 * Finds the index for a library version, downloading it through npm into a local cache the first
 * time. A release resolves to its highest published revision; a snapshot to the `develop` index.
 *
 * The registry is checked at most once a day per version, so a rebuilt index (a new revision)
 * arrives without a Hoist upgrade. When the registry cannot be reached, the cached index is used.
 */
export class IndexResolver {
    readonly cacheDir: string;
    private readonly registry: Registry;
    private readonly now: () => number;

    constructor(
        registry: Registry,
        cacheDir: string = defaultCacheDir(),
        now: () => number = Date.now
    ) {
        this.registry = registry;
        this.cacheDir = cacheDir;
        this.now = now;
    }

    /** Local path of the index for `version` of a library, fetching it if needed. */
    async resolve(libraryId: string, version: string): Promise<string> {
        const pkg = INDEX_PACKAGES[libraryId];
        if (!pkg) throw new Error(`No index package for library '${libraryId}'`);

        const key = `${pkg}@${isSnapshot(version) ? DEVELOP_TAG : version}`,
            resolutions = this.readResolutions(),
            cached = resolutions[key],
            cachedFile = cached ? this.fileFor(pkg, cached.pkgVersion) : null,
            fresh = cached && this.now() - cached.checkedAt < RECHECK_MS;
        if (fresh && cachedFile && existsSync(cachedFile)) return cachedFile;

        let pkgVersion: string | null;
        try {
            pkgVersion = isSnapshot(version)
                ? await this.registry.distTag(pkg, DEVELOP_TAG)
                : pickRevision(await this.registry.versions(pkg), version);
        } catch (e) {
            if (cachedFile && existsSync(cachedFile)) {
                log.warn('Registry unreachable - using cached index', {
                    pkg,
                    version,
                    error: String(e)
                });
                return cachedFile;
            }
            throw e;
        }
        if (!pkgVersion) {
            throw new Error(
                isSnapshot(version)
                    ? `No '${DEVELOP_TAG}' index published for ${pkg}.`
                    : `No index published for ${libraryId} ${version} (${pkg}). Releases are indexed from hoist-react v83 and hoist-core v37.`
            );
        }

        const file = this.fileFor(pkg, pkgVersion);
        if (!existsSync(file)) {
            const start = this.now(),
                index = readFromTgz(
                    await this.registry.pack(pkg, pkgVersion),
                    INDEX_FILE_IN_PACKAGE
                );
            if (!index) throw new Error(`${pkg}@${pkgVersion} holds no ${INDEX_FILE_IN_PACKAGE}`);
            mkdirSync(this.cacheDir, {recursive: true});
            writeFileSync(file, index);
            log.info('Fetched index', {pkg, pkgVersion, elapsedMs: this.now() - start});
        }

        resolutions[key] = {pkgVersion, checkedAt: this.now()};
        this.writeResolutions(resolutions);
        return file;
    }

    //------------------------
    // Implementation
    //------------------------
    private fileFor(pkg: string, pkgVersion: string): string {
        return join(this.cacheDir, `${pkg.replace(/^@[^/]+\//, '')}-${pkgVersion}.json.gz`);
    }

    private get resolutionsFile(): string {
        return join(this.cacheDir, 'resolved.json');
    }

    private readResolutions(): Record<string, Resolution> {
        try {
            return JSON.parse(readFileSync(this.resolutionsFile, 'utf8'));
        } catch {
            return {};
        }
    }

    private writeResolutions(resolutions: Record<string, Resolution>): void {
        mkdirSync(this.cacheDir, {recursive: true});
        writeFileSync(this.resolutionsFile, JSON.stringify(resolutions, null, 2));
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
