/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {readFileSync} from 'node:fs';
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
 * Fetches a Grails library's `docs-index` artifact from Maven, into the local cache, and the POMs
 * that tell which hoist-core version an app's other dependencies bring in. A release is
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
    /** True for each repository an organization named itself, rather than using the default. */
    private readonly ownRelease: boolean;
    private readonly ownSnapshot: boolean;
    private readonly cache: IndexCache;
    private readonly fetcher: Fetcher;
    private readonly now: () => number;

    constructor(opts: MavenOptions = {}) {
        this.ownRelease = Boolean(opts.releaseRepo);
        this.ownSnapshot = Boolean(opts.snapshotRepo);
        this.releaseRepo = trimSlash(opts.releaseRepo || MAVEN_CENTRAL);
        this.snapshotRepo = trimSlash(opts.snapshotRepo || SONATYPE_SNAPSHOTS);
        this.cache = opts.cache ?? new IndexCache();
        this.fetcher = opts.fetcher ?? httpFetcher(opts.user, opts.password);
        this.now = opts.now ?? Date.now;
    }

    /** True when an organization named its own repository for releases or for snapshots. */
    get hasOwnRepo(): boolean {
        return this.ownRelease || this.ownSnapshot;
    }

    /** True when `version` is fetched from a repository the organization named itself. */
    isOwnRepo(version: string): boolean {
        return isSnapshot(version) ? this.ownSnapshot : this.ownRelease;
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
        const path = await this.artifactFile(group, artifact, version, DOCS_INDEX);
        if (path) return path;
        throw new Error(
            isSnapshot(version)
                ? `${group}:${artifact} ${version} has no ${DOCS_INDEX_CLASSIFIER} artifact in ${this.snapshotRepo}.`
                : `${group}:${artifact} ${version} has no ${DOCS_INDEX_CLASSIFIER} artifact in ${this.releaseRepo} - releases from before Hoist Docs shipped indexes carry none. Upgrade, or serve an index directory (INDEX_DIR).`
        );
    }

    /** Local path of the docs index for `version`, fetching it if needed, or null if there is none. */
    async indexFile(group: string, artifact: string, version: string): Promise<string | null> {
        return this.artifactFile(group, artifact, version, DOCS_INDEX);
    }

    /**
     * The POM of `version` of `group:artifact`, or null when the repository has none. Cached as
     * an index is: a release for good, a snapshot's newest build rechecked daily.
     */
    async pom(group: string, artifact: string, version: string): Promise<string | null> {
        const path = await this.artifactFile(group, artifact, version, POM);
        return path ? readFileSync(path, 'utf8') : null;
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
    /** Local path of one file of `version`, fetching it if needed, or null if there is none. */
    private async artifactFile(
        group: string,
        artifact: string,
        version: string,
        file: ArtifactFile
    ): Promise<string | null> {
        return isSnapshot(version)
            ? this.snapshotFile(group, artifact, version, file)
            : this.releaseFile(group, artifact, version, file);
    }

    private async releaseFile(
        group: string,
        artifact: string,
        version: string,
        file: ArtifactFile
    ) {
        const remote = fileName(artifact, version, file),
            name = cacheName(group, remote, file);
        if (this.cache.has(name)) return this.cache.path(name);

        const data = await this.fetcher(
            `${artifactDir(this.releaseRepo, group, artifact)}/${version}/${remote}`
        );
        if (!data) return null;
        checkContent(remote, data, file);
        const path = this.cache.write(name, data);
        log.info(`Fetched ${file.label}`, {
            artifact: `${group}:${artifact}:${version}`,
            from: this.releaseRepo
        });
        return path;
    }

    private async snapshotFile(
        group: string,
        artifact: string,
        version: string,
        file: ArtifactFile
    ) {
        const key = `maven:${group}:${artifact}:${version}${file === DOCS_INDEX ? '' : `:${file.extension}`}`,
            cached = this.cache.resolution(key);
        if (cached && this.now() - cached.checkedAt < RECHECK_MS)
            return this.cache.path(cached.file);

        try {
            const dir = `${artifactDir(this.snapshotRepo, group, artifact)}/${version}`,
                meta = await this.fetcher(`${dir}/maven-metadata.xml`),
                // A remote repository timestamps each build; a local one (~/.m2) does not.
                build = (meta && snapshotBuild(meta.toString('utf8'), file)) ?? version,
                remote = fileName(artifact, build, file),
                name = cacheName(group, remote, file);
            if (!this.cache.has(name)) {
                const data = await this.fetcher(`${dir}/${remote}`);
                if (!data) throw new NotFound();
                checkContent(remote, data, file);
                this.cache.write(name, data);
                log.info(`Fetched ${file.label}`, {
                    artifact: `${group}:${artifact}:${build}`,
                    from: this.snapshotRepo
                });
            }
            this.cache.setResolution(key, name, this.now());
            return this.cache.path(name);
        } catch (e) {
            if (cached) {
                log.warn('Maven repository unreachable - using cached file', {
                    artifact: `${group}:${artifact}:${version}`,
                    file: file.label,
                    error: String(e)
                });
                return this.cache.path(cached.file);
            }
            if (e instanceof NotFound) return null;
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
/** A file published for each version of an artifact, told apart by classifier and extension. */
interface ArtifactFile {
    classifier?: string;
    extension: string;
    /** For log messages. */
    label: string;
    /** True if fetched data looks like this file, checked before it is cached. */
    isValid?: (data: Buffer) => boolean;
}

const DOCS_INDEX: ArtifactFile = {
        classifier: DOCS_INDEX_CLASSIFIER,
        extension: DOCS_INDEX_EXTENSION,
        label: 'index'
    },
    POM: ArtifactFile = {
        extension: 'pom',
        label: 'POM',
        isValid: data => data.toString('utf8').includes('<project')
    };

/**
 * Throws if `data` is not the file asked for. A proxy or a single sign-on gateway can answer with a
 * login page and HTTP 200, and a release, once cached, is never fetched again.
 */
function checkContent(remote: string, data: Buffer, file: ArtifactFile): void {
    if (file.isValid && !file.isValid(data)) {
        throw new Error(
            `${remote} from the Maven repository is not a ${file.label} - check the repository URL and credentials.`
        );
    }
}

/** A requested file the repository does not have. */
class NotFound extends Error {}

function fileName(artifact: string, version: string, file: ArtifactFile): string {
    const classifier = file.classifier ? `-${file.classifier}` : '';
    return `${artifact}-${version}${classifier}.${file.extension}`;
}

/**
 * Name of a file in the cache. An index keeps its published name. A POM's is prefixed with its
 * group, since any group may publish an artifact of the same name.
 */
function cacheName(group: string, remote: string, file: ArtifactFile): string {
    return file === DOCS_INDEX ? remote : `${group}.${remote}`;
}

function artifactDir(repo: string, group: string, artifact: string): string {
    return `${repo}/${group.replace(/\./g, '/')}/${artifact}`;
}

/** The timestamped build (`45.0-20261110.120000-3`) of a file, from a version's metadata. */
function snapshotBuild(xml: string, file: ArtifactFile): string | null {
    for (const m of xml.matchAll(/<snapshotVersion>([\s\S]*?)<\/snapshotVersion>/g)) {
        const block = m[1];
        if (
            tag(block, 'classifier') === (file.classifier ?? null) &&
            tag(block, 'extension') === file.extension
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

/**
 * How long one Maven request may take. The local tool fetches at startup, before the agent can
 * use it, so a proxy that accepts a connection and never answers must not hold it there.
 */
const FETCH_TIMEOUT_MS = 15_000;

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
        let res: Response;
        try {
            res = await fetch(url, {headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)});
        } catch (e) {
            // Node reports only "fetch failed"; the reason is in the cause.
            const cause = (e as {cause?: {code?: string; message?: string}}).cause,
                reason = cause?.code ?? cause?.message ?? (e as Error).message;
            throw new Error(
                `GET ${url} failed: ${reason}. Check network access to the Maven repository - behind a proxy, set NODE_USE_ENV_PROXY=1, or point HOIST_DOCS_MAVEN_REPO and HOIST_DOCS_MAVEN_SNAPSHOT_REPO at your organization's mirror.`,
                {cause: e}
            );
        }
        if (res.status === 404) return null;
        if (res.status === 401 || res.status === 403) {
            throw new Error(
                `GET ${url} failed: HTTP ${res.status}. Set HOIST_DOCS_MAVEN_USER and HOIST_DOCS_MAVEN_PASSWORD if the repository needs credentials.`
            );
        }
        if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
    };
}
