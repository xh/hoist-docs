/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {libraryDef} from '../libraries.ts';
import type {MavenSource} from './maven.ts';
import type {NpmSource} from './npm.ts';
import {LATEST_SNAPSHOT} from './project.ts';

/**
 * True for a plain version, such as `91.0.0`, `45.0-SNAPSHOT` or `1.0.0-rc.1`. A version reaches
 * `npm pack`, Maven URLs and cache file names, and on a gateway it comes from the caller. So it
 * must not be any other npm spec (a URL, git repo, alias or dist-tag) or hold a path separator.
 */
export function isVersion(version: string): boolean {
    return /^\d[0-9A-Za-z.+_-]*$/.test(version);
}

/** Where a built-in library's index is fetched from when it is not installed. */
export interface LibrarySource {
    /** The newest release of a library. */
    latestRelease(libraryId: string): Promise<string>;
    /**
     * The local path of a library version's index, fetching it if needed. `version` may be
     * {@link LATEST_SNAPSHOT}; the version returned is then the one it resolved to.
     */
    resolve(libraryId: string, version: string): Promise<{version: string; path: string}>;
}

/**
 * The built-in libraries' own channels: an npm library's published package, from which its index
 * is pulled, or a Grails library's `docs-index` Maven artifact.
 */
export class BuiltInSource implements LibrarySource {
    private readonly npm: NpmSource;
    private readonly maven: MavenSource;

    constructor(npm: NpmSource, maven: MavenSource) {
        this.npm = npm;
        this.maven = maven;
    }

    async latestRelease(libraryId: string): Promise<string> {
        const lib = this.lib(libraryId);
        if (lib.maven) return this.maven.latestRelease(lib.maven.group, lib.maven.artifact);
        return (await this.npm.resolveTag(npmName(lib), 'latest')).version;
    }

    async resolve(libraryId: string, version: string): Promise<{version: string; path: string}> {
        const lib = this.lib(libraryId);
        if (version !== LATEST_SNAPSHOT && !isVersion(version)) {
            throw new Error(`'${version}' is not a version of ${lib.packageName}`);
        }
        if (lib.maven) {
            const {group, artifact} = lib.maven,
                v =
                    version === LATEST_SNAPSHOT
                        ? await this.maven.latestSnapshot(group, artifact)
                        : version;
            return {version: v, path: await this.maven.resolve(group, artifact, v)};
        }
        const pkg = npmName(lib);
        return version === LATEST_SNAPSHOT
            ? this.npm.resolveTag(pkg, 'next')
            : {version, path: await this.npm.resolve(pkg, version)};
    }

    private lib(libraryId: string) {
        const lib = libraryDef(libraryId);
        if (!lib) throw new Error(`Unknown library '${libraryId}'`);
        return lib;
    }
}

function npmName(lib: NonNullable<ReturnType<typeof libraryDef>>): string {
    if (!('npm' in lib.installed)) throw new Error(`${lib.id} is not an npm library`);
    return lib.installed.npm;
}
