/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

import {compareVersions} from '../IndexStore.ts';
import {LIBRARIES, type LibraryDef} from '../libraries.ts';
import {log} from '../log.ts';
import {
    type DependencySearch,
    gradleProperty,
    type IndexedDependency,
    lockedVersion,
    type PomSource,
    searchDependencies
} from './gradle.ts';

/** The versions of the built-in libraries a project uses, as found on disk. */
export interface ProjectVersions {
    /** Version of each library the project uses, by library id. Libraries it lacks are absent. */
    versions: Record<string, string>;
    /** Problems worth telling the developer about, e.g. dependencies not installed. */
    notes: string[];
    /** The library, if `root` is a checkout of a built-in library itself. */
    checkout?: string;
    /**
     * Libraries a Grails project must use but whose version was not found, with why. Set only by
     * {@link resolveProjectVersions}.
     */
    missing?: Array<{libraryId: string; reason: string}>;
    /**
     * The Grails libraries among the project's dependencies that ship a Hoist Docs index, found
     * through their POMs. Set only by {@link resolveProjectVersions}.
     */
    indexed?: IndexedDependency[];
}

/**
 * Version standing for a library's newest published snapshot: npm's `next` dist-tag, or the
 * newest snapshot in the Maven snapshot repository. Served in a library checkout, which has no
 * installed build of itself.
 */
export const LATEST_SNAPSHOT = 'latest-snapshot';

/**
 * Find the versions of the built-in libraries the project at `root` uses. An npm library's is the
 * exact version installed in `client-app/node_modules` (or `node_modules`), rather than the range
 * in package.json, since that is the code the app actually runs. hoist-core's is the version in
 * `gradle.lockfile`, else `hoistCoreVersion` from `gradle.properties`.
 *
 * A checkout of a built-in library itself is served its own newest published snapshot - for
 * hoist-core, the newest build of its own snapshot line - plus the other libraries as installed
 * there, else, for hoist-react and hoist-core, their newest published snapshots.
 */
export function detectProjectVersions(root: string): ProjectVersions {
    const projectRoot = resolve(root),
        checkout = detectCheckout(projectRoot),
        ret: ProjectVersions = {versions: {}, notes: []};
    if (checkout) ret.checkout = checkout.library;

    for (const lib of LIBRARIES) {
        const version =
            checkout?.library === lib.id
                ? checkout.version
                : (installedVersion(projectRoot, lib, ret.notes) ??
                  (checkout && !lib.optional ? LATEST_SNAPSHOT : null));
        if (version) ret.versions[lib.id] = version;
    }
    return ret;
}

/**
 * {@link detectProjectVersions}, then, for a Grails project, what the POMs of its declared
 * dependencies add:
 *
 * - The version of each Maven library it names nowhere itself. An app that gets hoist-core through
 *   an organization's own Grails plugin names only the plugin's version. A library still not found
 *   is listed in `missing`.
 * - With `opts.findIndexes`, the Grails libraries among its dependencies that ship a Hoist Docs
 *   index, in `indexed`. Where the dependencies hold several versions of one, the highest, as
 *   Gradle resolves them.
 *
 * The POMs are read only when one of these is needed. Libraries in `opts.skip`, served from
 * elsewhere, are not looked up.
 */
export async function resolveProjectVersions(
    root: string,
    poms: PomSource,
    opts: {skip?: ReadonlySet<string>; findIndexes?: boolean} = {}
): Promise<ProjectVersions> {
    const projectRoot = resolve(root),
        skip = opts.skip ?? new Set<string>(),
        ret = detectProjectVersions(projectRoot),
        isGrails = ['build.gradle', 'build.gradle.kts'].some(f => existsSync(join(projectRoot, f)));
    if (ret.checkout || !isGrails) return ret;

    const versions: Record<string, string> = {},
        indexed = new Map<string, IndexedDependency>();
    ret.missing = [];
    for (const lib of LIBRARIES) {
        let version = ret.versions[lib.id];
        const needsVersion = !version && lib.maven && !lib.optional && !skip.has(lib.id);
        if (lib.maven && (needsVersion || opts.findIndexes)) {
            // Only to find indexes, so only in the organization's own repository.
            const search = await searchDependencies(projectRoot, lib.maven, poms, {
                ownRepoOnly: !needsVersion
            });
            if (opts.findIndexes) {
                for (const dep of search.indexed) {
                    if (!skip.has(dep.libraryId)) addIndexed(indexed, dep);
                }
            }
            if (needsVersion) {
                if (search.found) {
                    version = search.found.version;
                    log.info(`Found ${lib.packageName} through a dependency`, {...search.found});
                } else {
                    ret.missing.push({libraryId: lib.id, reason: missingReason(lib, search)});
                }
            } else if (search.notFound.length || search.errors.length) {
                // The version is known, so only Grails plugins' indexes may be missed.
                log.warn(
                    "Could not read some dependency POMs, so any Hoist Docs index they declare is not served. Check HOIST_DOCS_MAVEN_REPO if your organization's plugins are among them.",
                    {notFound: search.notFound, errors: search.errors}
                );
            }
        }
        if (version) versions[lib.id] = version;
    }
    ret.versions = versions;
    if (opts.findIndexes) ret.indexed = [...indexed.values()];
    return ret;
}

//------------------------
// Implementation
//------------------------
/** The version of `lib` the project uses, or null. Notes a declared but uninstalled package. */
function installedVersion(root: string, lib: LibraryDef, notes: string[]): string | null {
    if ('gradleProperty' in lib.installed) {
        const property = lib.installed.gradleProperty,
            locked = lib.maven && lockedVersion(root, lib.maven.group, lib.maven.artifact),
            set = gradleProperty(root, property);
        if (locked && set && locked !== set) {
            notes.push(
                `gradle.lockfile locks ${lib.packageName} ${locked}, but gradle.properties sets ${property}=${set}. Serving ${locked}, the version Gradle resolves. Run ./gradlew dependencies --write-locks, then restart.`
            );
        }
        return locked || set;
    }

    const name = lib.installed.npm;
    for (const dir of [join(root, 'client-app'), root]) {
        const installed = readJson(join(dir, 'node_modules', ...name.split('/'), 'package.json'));
        if (installed?.version) return installed.version;
        const pkg = readJson(join(dir, 'package.json')),
            deps = {...pkg?.dependencies, ...pkg?.devDependencies};
        if (deps[name]) {
            notes.push(
                `${join(dir, 'package.json')} depends on ${name}, but it is not installed - run your package manager's install, then restart.`
            );
            return null;
        }
    }
    return null;
}

/** The built-in library and version of a checkout at `root`, if it is one. */
function detectCheckout(root: string): {library: string; version: string} | null {
    const pkg = readJson(join(root, 'package.json')),
        settings = readText(join(root, 'settings.gradle'));
    for (const lib of LIBRARIES) {
        const c = lib.checkout;
        if ('packageName' in c) {
            if (pkg?.name === c.packageName) return {library: lib.id, version: LATEST_SNAPSHOT};
        } else if (settings && rootProjectName(settings) === c.gradleProject) {
            return {
                library: lib.id,
                version: gradleProperty(root, c.versionProperty) ?? LATEST_SNAPSHOT
            };
        }
    }
    return null;
}

function rootProjectName(settings: string): string | null {
    return /^\s*rootProject\.name\s*=\s*['"]([^'"]+)['"]/m.exec(settings)?.[1] ?? null;
}

/**
 * Keep the highest version of each library id. Two different artifacts claiming one id keep XH's
 * own, else one the app declares directly, else the first, with a warning - as for npm packages.
 */
function addIndexed(indexed: Map<string, IndexedDependency>, dep: IndexedDependency): void {
    const prev = indexed.get(dep.libraryId),
        rank = (d: IndexedDependency) => (d.group === 'io.xh' ? 2 : d.direct ? 1 : 0);
    if (!prev) {
        indexed.set(dep.libraryId, dep);
    } else if (prev.group !== dep.group || prev.artifact !== dep.artifact) {
        const keep = rank(dep) > rank(prev) ? dep : prev,
            drop = keep === prev ? dep : prev;
        indexed.set(dep.libraryId, keep);
        log.warn(
            `${drop.group}:${drop.artifact} and ${keep.group}:${keep.artifact} both declare Hoist Docs id '${dep.libraryId}' - serving ${keep.group}:${keep.artifact}.`
        );
    } else {
        // One artifact at several versions: the highest, declared directly if any of them is.
        const keep = compareVersions(dep.version, prev.version) > 0 ? dep : prev;
        indexed.set(dep.libraryId, {...keep, direct: prev.direct || dep.direct});
    }
}

function missingReason(lib: LibraryDef, search: DependencySearch): string {
    const property = 'gradleProperty' in lib.installed ? lib.installed.gradleProperty : '',
        {notFound, errors} = search,
        list = (items: string[]) =>
            items.slice(0, 3).join(', ') +
            (items.length > 3 ? ` and ${items.length - 3} more` : '');
    return [
        `No ${lib.packageName} version found in gradle.lockfile, in ${property} in gradle.properties, or in the POMs of the dependencies build.gradle declares.`,
        notFound.length
            ? `The Maven repository has no POM for ${list(notFound)}. If your organization's own plugins are among them, point HOIST_DOCS_MAVEN_REPO and HOIST_DOCS_MAVEN_SNAPSHOT_REPO at the repository that hosts them.`
            : '',
        errors.length ? `Could not read: ${list(errors)}.` : '',
        `Or commit a gradle.lockfile, or set ${property} in gradle.properties.`
    ]
        .filter(Boolean)
        .join(' ');
}

function readText(path: string): string | null {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return null;
    }
}

function readJson(path: string): any {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return null;
    }
}
