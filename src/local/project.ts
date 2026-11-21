/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

import {LIBRARIES, type LibraryDef} from '../libraries.ts';
import {log} from '../log.ts';
import {
    type DependencySearch,
    gradleProperty,
    lockedVersion,
    type PomSource,
    versionFromDependencies
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
 * {@link detectProjectVersions}, then, for a Grails project, the version of each Maven library it
 * names nowhere itself: the version its declared dependencies bring in, read from their POMs. An
 * app that gets hoist-core through an organization's own Grails plugin names only the plugin's
 * version. A library still not found is listed in `missing`. Libraries in `skip`, served from
 * elsewhere, are not looked up.
 */
export async function resolveProjectVersions(
    root: string,
    poms: PomSource,
    skip: ReadonlySet<string> = new Set()
): Promise<ProjectVersions> {
    const projectRoot = resolve(root),
        ret = detectProjectVersions(projectRoot),
        isGrails = ['build.gradle', 'build.gradle.kts'].some(f => existsSync(join(projectRoot, f)));
    if (ret.checkout || !isGrails) return ret;

    const versions: Record<string, string> = {};
    ret.missing = [];
    for (const lib of LIBRARIES) {
        let version = ret.versions[lib.id];
        if (!version && lib.maven && !lib.optional && !skip.has(lib.id)) {
            const search = await versionFromDependencies(projectRoot, lib.maven, poms);
            if (search.found) {
                version = search.found.version;
                log.info(`Found ${lib.packageName} through a dependency`, {...search.found});
            } else {
                ret.missing.push({libraryId: lib.id, reason: missingReason(lib, search)});
            }
        }
        if (version) versions[lib.id] = version;
    }
    ret.versions = versions;
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
