/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

import {LIBRARIES, type LibraryDef} from '../libraries.ts';

/** The versions of the built-in libraries a project uses, as found on disk. */
export interface ProjectVersions {
    /** Version of each library the project uses, by library id. Libraries it lacks are absent. */
    versions: Record<string, string>;
    /** Problems worth telling the developer about, e.g. dependencies not installed. */
    notes: string[];
    /** The library, if `root` is a checkout of a built-in library itself. */
    checkout?: string;
    /** Libraries a Grails project must use but whose version was not found, with why. */
    missing: Array<{libraryId: string; reason: string}>;
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
        isGrails = ['build.gradle', 'build.gradle.kts'].some(f => existsSync(join(projectRoot, f))),
        ret: ProjectVersions = {versions: {}, notes: [], missing: []};
    if (checkout) ret.checkout = checkout.library;

    for (const lib of LIBRARIES) {
        const version =
            checkout?.library === lib.id
                ? checkout.version
                : (installedVersion(projectRoot, lib, ret.notes) ??
                  (checkout && !lib.optional ? LATEST_SNAPSHOT : null));
        if (version) {
            ret.versions[lib.id] = version;
        } else if (isGrails && 'gradleProperty' in lib.installed && !lib.optional) {
            ret.missing.push({libraryId: lib.id, reason: missingReason(lib)});
        }
    }
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

/** Why no version of `lib`, a Grails library, was found, and how to fix it. */
function missingReason(lib: LibraryDef): string {
    const property = 'gradleProperty' in lib.installed ? lib.installed.gradleProperty : '';
    return `No ${lib.packageName} version found: gradle.lockfile does not list it, and gradle.properties does not set ${property}. Commit a gradle.lockfile (./gradlew dependencies --write-locks), which lists it even when it comes through another plugin, then restart.`;
}

/**
 * The version of `group:artifact` in the project's `gradle.lockfile`, or null. A lockfile lists
 * every module Gradle resolved, those brought in by other dependencies included, so it is exact
 * even when the build file names no version. Prefers the version the app runs with, should
 * configurations differ.
 */
function lockedVersion(root: string, group: string, artifact: string): string | null {
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
    for (const config of ['runtimeClasspath', 'compileClasspath']) {
        const lock = locks.find(l => l.configs.includes(config));
        if (lock) return lock.version;
    }
    return locks[0]?.version || null;
}

function gradleProperty(root: string, name: string): string | null {
    const props = readText(join(root, 'gradle.properties'));
    if (!props) return null;
    return new RegExp(`^\\s*${name}\\s*[=:]\\s*(\\S+)\\s*$`, 'm').exec(props)?.[1] ?? null;
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
