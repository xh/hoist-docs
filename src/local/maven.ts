/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

import {compareVersions} from '../IndexStore.ts';
import {log} from '../log.ts';
import {IndexCache, RECHECK_MS} from './cache.ts';

/** Classifier and extension a Grails library's index is published under, beside its jar. */
export const DOCS_INDEX_CLASSIFIER = 'docs-index';
export const DOCS_INDEX_EXTENSION = 'json.gz';

/** Fetch a URL's body, or null when it does not exist (404, or no such file). Injectable for tests. */
export type Fetcher = (url: string) => Promise<Buffer | null>;

export interface MavenOptions {
    /** Repository for releases. Default Maven Central. */
    releaseRepo?: string;
    /** Repository for snapshots. Default Sonatype's snapshot repository. */
    snapshotRepo?: string;
    /** Basic auth for an organization's mirror. */
    user?: string;
    password?: string;
    cache?: IndexCache;
    fetcher?: Fetcher;
    now?: () => number;
}

export const MAVEN_CENTRAL = 'https://repo1.maven.org/maven2';
export const SONATYPE_SNAPSHOTS = 'https://central.sonatype.com/repository/maven-snapshots';

/**
 * Fetches a Grails library's `docs-index` artifact from Maven, into the local cache. A release is
 * fetched once. A snapshot resolves to its newest timestamped build through the version's
 * `maven-metadata.xml`, rechecked at most daily, as Gradle treats a changing snapshot; when the
 * repository cannot be reached, the cached build is used.
 *
 * `file:` repository URLs work too, including a local Maven repository (`~/.m2/repository`), whose
 * snapshots are not timestamped.
 */
export class MavenSource {
    readonly releaseRepo: string;
    readonly snapshotRepo: string;
    private readonly cache: IndexCache;
    private readonly fetcher: Fetcher;
    private readonly now: () => number;

    constructor(opts: MavenOptions = {}) {
        this.releaseRepo = trimSlash(opts.releaseRepo || MAVEN_CENTRAL);
        this.snapshotRepo = trimSlash(opts.snapshotRepo || SONATYPE_SNAPSHOTS);
        this.cache = opts.cache ?? new IndexCache();
        this.fetcher = opts.fetcher ?? httpFetcher(opts.user, opts.password);
        this.now = opts.now ?? Date.now;
    }

    /** Settings from the environment: see the Configuration table in docs/design.md. */
    static fromEnv(env: Record<string, string | undefined>, cache?: IndexCache): MavenSource {
        return new MavenSource({
            releaseRepo: env.HOIST_DOCS_MAVEN_REPO,
            snapshotRepo: env.HOIST_DOCS_MAVEN_SNAPSHOT_REPO,
            user: env.HOIST_DOCS_MAVEN_USER,
            password: env.HOIST_DOCS_MAVEN_PASSWORD,
            cache
        });
    }

    /** Local path of the docs index for `version` of `group:artifact`, fetching it if needed. */
    async resolve(group: string, artifact: string, version: string): Promise<string> {
        return isSnapshot(version)
            ? this.resolveSnapshot(group, artifact, version)
            : this.resolveRelease(group, artifact, version);
    }

    /** The newest release, from the artifact's `maven-metadata.xml`. */
    async latestRelease(group: string, artifact: string): Promise<string> {
        const xml = await this.metadata(this.releaseRepo, group, artifact),
            release =
                xml &&
                (tag(xml, 'release') ??
                    versions(xml)
                        .filter(v => !isSnapshot(v))
                        .at(-1));
        if (!release)
            throw new Error(`No release of ${group}:${artifact} found in ${this.releaseRepo}`);
        return release;
    }

    /** The newest snapshot version (e.g. `45.0-SNAPSHOT`) in the snapshot repository. */
    async latestSnapshot(group: string, artifact: string): Promise<string> {
        const xml = await this.metadata(this.snapshotRepo, group, artifact),
            snapshot = xml && versions(xml).filter(isSnapshot).sort(compareVersions).at(-1);
        if (!snapshot) {
            throw new Error(`No snapshot of ${group}:${artifact} found in ${this.snapshotRepo}`);
        }
        return snapshot;
    }

    //------------------------
    // Implementation
    //------------------------
    private async resolveRelease(group: string, artifact: string, version: string) {
        const name = fileName(artifact, version);
        if (this.cache.has(name)) return this.cache.path(name);

        const data = await this.fetcher(
            `${artifactDir(this.releaseRepo, group, artifact)}/${version}/${name}`
        );
        if (!data) {
            throw new Error(
                `${group}:${artifact} ${version} has no ${DOCS_INDEX_CLASSIFIER} artifact in ${this.releaseRepo} - releases from before Hoist Docs shipped indexes carry none. Upgrade, or serve an index directory (INDEX_DIR).`
            );
        }
        const path = this.cache.write(name, data);
        log.info('Fetched index', {
            artifact: `${group}:${artifact}:${version}`,
            from: this.releaseRepo
        });
        return path;
    }

    private async resolveSnapshot(group: string, artifact: string, version: string) {
        const key = `maven:${group}:${artifact}:${version}`,
            cached = this.cache.resolution(key);
        if (cached && this.now() - cached.checkedAt < RECHECK_MS)
            return this.cache.path(cached.file);

        try {
            const dir = `${artifactDir(this.snapshotRepo, group, artifact)}/${version}`,
                meta = await this.fetcher(`${dir}/maven-metadata.xml`),
                // A remote repository timestamps each build; a local one (~/.m2) does not.
                build = (meta && snapshotBuild(meta.toString('utf8'))) ?? version,
                name = fileName(artifact, build);
            if (!this.cache.has(name)) {
                const data = await this.fetcher(`${dir}/${name}`);
                if (!data) {
                    throw new Error(
                        `${group}:${artifact} ${version} has no ${DOCS_INDEX_CLASSIFIER} artifact in ${this.snapshotRepo}.`
                    );
                }
                this.cache.write(name, data);
                log.info('Fetched index', {
                    artifact: `${group}:${artifact}:${build}`,
                    from: this.snapshotRepo
                });
            }
            this.cache.setResolution(key, name, this.now());
            return this.cache.path(name);
        } catch (e) {
            if (cached) {
                log.warn('Maven repository unreachable - using cached index', {
                    artifact: `${group}:${artifact}:${version}`,
                    error: String(e)
                });
                return this.cache.path(cached.file);
            }
            throw e;
        }
    }

    private async metadata(repo: string, group: string, artifact: string): Promise<string | null> {
        const data = await this.fetcher(`${artifactDir(repo, group, artifact)}/maven-metadata.xml`);
        return data?.toString('utf8') ?? null;
    }
}

export function isSnapshot(version: string): boolean {
    return /-SNAPSHOT$/i.test(version);
}

//------------------------
// Implementation
//------------------------
function fileName(artifact: string, version: string): string {
    return `${artifact}-${version}-${DOCS_INDEX_CLASSIFIER}.${DOCS_INDEX_EXTENSION}`;
}

function artifactDir(repo: string, group: string, artifact: string): string {
    return `${repo}/${group.replace(/\./g, '/')}/${artifact}`;
}

/** The timestamped build (`45.0-20261110.120000-3`) of the docs index, from a version's metadata. */
function snapshotBuild(xml: string): string | null {
    for (const m of xml.matchAll(/<snapshotVersion>([\s\S]*?)<\/snapshotVersion>/g)) {
        const block = m[1];
        if (
            tag(block, 'classifier') === DOCS_INDEX_CLASSIFIER &&
            tag(block, 'extension') === DOCS_INDEX_EXTENSION
        ) {
            return tag(block, 'value');
        }
    }
    return null;
}

function versions(xml: string): string[] {
    return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1].trim());
}

function tag(xml: string, name: string): string | null {
    return new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1].trim() || null;
}

function trimSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

function httpFetcher(user?: string, password?: string): Fetcher {
    const headers: Record<string, string> = user
        ? {Authorization: 'Basic ' + Buffer.from(`${user}:${password ?? ''}`).toString('base64')}
        : {};
    return async url => {
        if (url.startsWith('file:')) {
            try {
                return await readFile(fileURLToPath(url));
            } catch (e) {
                if ((e as {code?: string}).code === 'ENOENT') return null;
                throw e;
            }
        }
        const res = await fetch(url, {headers});
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
    };
}
