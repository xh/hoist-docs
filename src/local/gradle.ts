/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {compareVersions} from '../IndexStore.ts';
import {log} from '../log.ts';

/**
 * Reads what a Grails project's build says about its dependencies, without running Gradle: its
 * lockfile, its `gradle.properties`, the dependencies its build file declares, and the POMs of
 * those dependencies.
 */

/** Maven coordinates, with a version where one is known. */
export interface Coordinates {
    group: string;
    artifact: string;
    version: string;
}

/** Fetches a POM, or null when the repository has none. `MavenSource` is one. */
export interface PomSource {
    pom(group: string, artifact: string, version: string): Promise<string | null>;
    /** True when `version` is fetched from a repository the organization named itself. */
    isOwnRepo?(version: string): boolean;
}

/** A version found in dependencies' POMs, and the declared dependency that brought it in. */
export interface DependencyVersion {
    version: string;
    via: string;
}

/** A dependency whose POM declares that it ships a Hoist Docs index, and the index's id. */
export interface IndexedDependency extends Coordinates {
    libraryId: string;
    /** True if the project's build file declares it, rather than another dependency. */
    direct: boolean;
}

/** What a search of the dependencies' POMs found, and the POMs it could not read. */
export interface DependencySearch {
    /** The version of the library searched for, if any POM lists it. */
    found: DependencyVersion | null;
    /** Dependencies that ship an index, declared by `hoistDocs.id` in their POM's properties. */
    indexed: IndexedDependency[];
    /** POMs the repository did not have, as `group:artifact:version`. */
    notFound: string[];
    /** POMs that failed to fetch, and why. A search that ran out of time adds one entry. */
    errors: string[];
}

/**
 * The version of `group:artifact` in the project's `gradle.lockfile`, or null. A lockfile lists
 * the version each configuration resolved, so it is exact even when the build file names no
 * version. Prefers the version the app runs with, should configurations differ.
 */
export function lockedVersion(root: string, group: string, artifact: string): string | null {
    const text = readText(join(root, 'gradle.lockfile'));
    if (!text) return null;
    const prefix = `${group}:${artifact}:`,
        locks = text
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.startsWith(prefix))
            .map(l => {
                const [version, configs = ''] = l.slice(prefix.length).split('=');
                return {version, configs: configs.split(',')};
            });
    const preferred = ['runtimeClasspath', 'compileClasspath'];
    for (const config of preferred) {
        const lock = locks.find(l => l.configs.includes(config));
        if (lock) return lock.version;
    }
    return locks[0]?.version || null;
}

/** One property from the project's `gradle.properties`, or null. */
export function gradleProperty(root: string, name: string): string | null {
    return gradleProperties(root)[name] ?? null;
}

/**
 * The dependencies the project's build file declares with a version, as Gradle would read them:
 * `"group:artifact:version"` strings, `platform(...)` ones among them, and
 * `group: ..., name: ..., version: ...` maps. A version may name a property in `gradle.properties`
 * (`$clientPluginVersion`). A version it cannot settle on its own, such as `1.+` or a property
 * set in the build script, is taken from `gradle.lockfile` if the project has one, else the
 * dependency is skipped. Build script `classpath` entries, which are Gradle plugins, are skipped.
 */
export function declaredDependencies(root: string): Coordinates[] {
    const text = readText(join(root, 'build.gradle')) ?? readText(join(root, 'build.gradle.kts'));
    if (!text) return [];

    const props = gradleProperties(root),
        ret = new Map<string, Coordinates>(),
        add = (group: string, artifact: string, version: string) => {
            version = interpolate(version, props);
            // A dynamic version (`3.+`) or one set in the build script: the lockfile may have it.
            if (!VERSION.test(version)) version = lockedVersion(root, group, artifact) ?? '';
            if (!VERSION.test(version)) return;
            ret.set(`${group}:${artifact}:${version}`, {group, artifact, version});
        };

    let inComment = false;
    for (const raw of text.split('\n')) {
        // A `/* */` block that starts its line. One that starts mid-line is rare, and `/*` can
        // be part of a string, such as a file pattern.
        if (inComment || /^\s*\/\*/.test(raw)) {
            inComment = !raw.includes('*/');
            continue;
        }
        // A `//` comment, but not the `//` of a URL.
        const line = raw.replace(/(^|\s)\/\/.*$/, '$1'),
            config = /^\s*([A-Za-z]\w*)\b/.exec(line)?.[1];
        if (!config || config === 'classpath') continue;

        const str = /^\s*\w+\s*\(?\s*(?:(?:enforcedP|p)latform\s*\(\s*)?(['"])([^'"]+)\1/.exec(
            line
        );
        if (str) {
            const [group, artifact, version] = interpolate(str[2], props).split(':');
            if (group && artifact && version) add(group, artifact, version.split('@')[0]);
            continue;
        }
        const group = mapEntry(line, 'group'),
            artifact = mapEntry(line, 'name'),
            version = mapEntry(line, 'version');
        if (group && artifact && version) add(group, artifact, version);
    }
    return [...ret.values()];
}

/**
 * Read the POMs of the project's declared dependencies, for two things:
 *
 * - The version of `target` they bring in, as when an app depends on an organization's Grails
 *   plugin and gets hoist-core through it. Where several versions turn up, the highest, as Gradle
 *   resolves them.
 * - The dependencies that ship a Hoist Docs index, which their POM declares with a property:
 *   `<hoistDocs.id>acme</hoistDocs.id>`. Their index is the `docs-index` artifact beside their jar.
 *
 * Follows a dependency's own dependencies in the same group, a few levels down, so a plugin that
 * builds on another of the organization's plugins is covered.
 *
 * A POM that cannot be read is skipped and reported. The search stops at `opts.timeoutMs`, since
 * the agent waits for it before the server answers. With `opts.ownRepoOnly`, it asks only a
 * repository the organization named itself, so private coordinates never reach a public one.
 */
export async function searchDependencies(
    root: string,
    target: {group: string; artifact: string},
    poms: PomSource,
    opts: {timeoutMs?: number; ownRepoOnly?: boolean} = {}
): Promise<DependencySearch> {
    const timeoutMs = opts.timeoutMs ?? SEARCH_TIMEOUT_MS,
        mayAsk = (c: Coordinates) =>
            !opts.ownRepoOnly || (poms.isOwnRepo ? poms.isOwnRepo(c.version) : true);
    const isTarget = (c: {group: string; artifact: string}) =>
            c.group === target.group && c.artifact === target.artifact,
        declared = declaredDependencies(root),
        found: DependencyVersion[] = declared
            .filter(isTarget)
            .map(c => ({version: c.version, via: 'build.gradle'})),
        ret: DependencySearch = {found: null, indexed: [], notFound: [], errors: []},
        deadline = Date.now() + timeoutMs,
        seen = new Set<string>();

    let level = declared.filter(c => !isTarget(c)).map(c => ({coords: c, via: format(c)}));
    level.forEach(({coords}) => seen.add(format(coords)));
    for (let depth = 1; depth <= MAX_DEPTH && level.length; depth++) {
        // Filled in as each POM arrives, so a slow one costs only itself when time runs out.
        const read: Array<string | null> = level.map(() => null),
            done = await withDeadline(
                Promise.all(
                    level.map(async ({coords}, i) => {
                        if (!mayAsk(coords)) return;
                        try {
                            const pom = await poms.pom(
                                coords.group,
                                coords.artifact,
                                coords.version
                            );
                            if (!pom) ret.notFound.push(format(coords));
                            read[i] = pom;
                        } catch (e) {
                            log.debug('Could not read POM', {
                                artifact: format(coords),
                                error: String(e)
                            });
                            ret.errors.push(`${format(coords)}: ${(e as Error).message}`);
                        }
                    })
                ),
                deadline - Date.now()
            );

        const next: typeof level = [];
        level.forEach(({coords, via}, i) => {
            const pom = read[i];
            if (!pom) return;
            const {dependencies, managed, docsId} = pomDependencies(pom, coords.version);
            if (docsId) ret.indexed.push({...coords, libraryId: docsId, direct: depth === 1});
            for (const dep of [...dependencies, ...managed]) {
                if (isTarget(dep)) found.push({version: dep.version, via});
            }
            for (const dep of dependencies) {
                const key = format(dep);
                if (!isTarget(dep) && dep.group === coords.group && !seen.has(key)) {
                    seen.add(key);
                    next.push({coords: dep, via});
                }
            }
        });
        if (!done) {
            ret.errors.push(`gave up after ${timeoutMs / 1000}s`);
            break;
        }
        level = next;
    }

    ret.found = found.sort((a, b) => compareVersions(a.version, b.version)).at(-1) ?? null;
    return ret;
}

//------------------------
// Implementation
//------------------------
/** How many levels of POMs to read below the build file: a plugin, and two of its own. */
const MAX_DEPTH = 3;

/** The POM property by which a Grails library declares that it ships a Hoist Docs index. */
const DOCS_ID_PROPERTY = 'hoistDocs.id';

/** A plain version, such as `3.2.0` or `45.0-SNAPSHOT`. */
const VERSION = /^\d[0-9A-Za-z._-]*$/;

/** A library id: it prefixes doc ids (`acme:docs/x.md`) and names index files. */
const LIBRARY_ID = /^[a-z][a-z0-9-]*$/;

/** How long the whole search may take, however slow the repository. */
const SEARCH_TIMEOUT_MS = 20_000;

/** The promise's value, or null if `ms` passes first. */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>(done => (timer = setTimeout(() => done(null), ms)));
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The dependencies a POM lists with a version: those in `<dependencies>`, and those it manages in
 * `<dependencyManagement>`. Only the first are followed further, since a BOM manages many
 * artifacts of its own group that the app may not use. Versions given as `${property}` are read
 * from the POM's `<properties>`. Test and provided dependencies are left out, since they do not
 * reach the app. Also the id of the Hoist Docs index the POM declares, if any.
 */
function pomDependencies(
    pom: string,
    ownVersion: string
): {dependencies: Coordinates[]; managed: Coordinates[]; docsId: string | null} {
    const props: Record<string, string> = {'project.version': ownVersion};
    const propsBlock = /<properties>([\s\S]*?)<\/properties>/.exec(pom)?.[1] ?? '';
    for (const m of propsBlock.matchAll(/<([\w.-]+)>([^<]*)<\/\1>/g)) props[m[1]] = m[2].trim();

    const managedBlock = /<dependencyManagement>([\s\S]*?)<\/dependencyManagement>/.exec(pom)?.[1],
        docsId = props[DOCS_ID_PROPERTY];
    if (docsId && !LIBRARY_ID.test(docsId)) {
        log.warn(
            `Ignored ${DOCS_ID_PROPERTY} '${docsId}' - expected lowercase letters, digits and -.`
        );
    }
    return {
        dependencies: dependencyList(managedBlock ? pom.replace(managedBlock, '') : pom, props),
        managed: managedBlock ? dependencyList(managedBlock, props) : [],
        docsId: docsId && LIBRARY_ID.test(docsId) ? docsId : null
    };
}

function dependencyList(xml: string, props: Record<string, string>): Coordinates[] {
    const ret: Coordinates[] = [];
    for (const m of xml.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
        const block = m[1],
            group = tag(block, 'groupId'),
            artifact = tag(block, 'artifactId'),
            scope = tag(block, 'scope'),
            version = (tag(block, 'version') ?? '').replace(
                /\$\{([^}]+)\}/g,
                (all, name) => props[name] ?? all
            );
        if (!group || !artifact || scope === 'test' || scope === 'provided') continue;
        if (!VERSION.test(version)) continue;
        ret.push({group, artifact, version});
    }
    return ret;
}

/** Every property in `gradle.properties`. */
function gradleProperties(root: string): Record<string, string> {
    const ret: Record<string, string> = {},
        text = readText(join(root, 'gradle.properties')) ?? '';
    for (const m of text.matchAll(/^[ \t]*([^#!\s=:][^\s=:]*)[ \t]*[=:][ \t]*(\S+)[ \t]*$/gm)) {
        ret[m[1]] = m[2];
    }
    return ret;
}

/** Replace `$name` and `${name}` with project properties, leaving unknown ones in place. */
function interpolate(s: string, props: Record<string, string>): string {
    return s.replace(/\$\{(\w+)\}|\$(\w+)/g, (all, a, b) => props[a ?? b] ?? all);
}

/** The value of `key: 'value'` in a dependency map, or null. */
function mapEntry(line: string, key: string): string | null {
    return new RegExp(`\\b${key}\\s*:\\s*(['"])([^'"]+)\\1`).exec(line)?.[2] ?? null;
}

function tag(xml: string, name: string): string | null {
    return new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1].trim() || null;
}

function format(c: Coordinates): string {
    return `${c.group}:${c.artifact}:${c.version}`;
}

function readText(path: string): string | null {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return null;
    }
}
