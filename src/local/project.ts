/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {readFileSync} from 'node:fs';
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
}

/** Version given to a library with no version of its own in a project: its `develop` index. */
export const DEVELOP_VERSION = 'develop';

/**
 * Find the versions of the built-in libraries the project at `root` uses. An npm library's is the
 * exact version installed in `client-app/node_modules` (or `node_modules`), rather than the range
 * in package.json, since that is the code the app actually runs; hoist-core's is
 * `hoistCoreVersion` from `gradle.properties`.
 *
 * A checkout of a built-in library itself is served its own version (a snapshot, so the `develop`
 * index), plus the other libraries as installed there, else - for hoist-react and hoist-core -
 * their `develop` indexes.
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
                  (checkout && !lib.optional ? DEVELOP_VERSION : null));
        if (version) ret.versions[lib.id] = version;
    }
    return ret;
}

/** True for a version with no released index: a snapshot, served from the `develop` index. */
export function isSnapshot(version: string): boolean {
    return version === DEVELOP_VERSION || /snapshot/i.test(version);
}

//------------------------
// Implementation
//------------------------
/** The version of `lib` the project uses, or null. Notes a declared but uninstalled package. */
function installedVersion(root: string, lib: LibraryDef, notes: string[]): string | null {
    if ('gradleProperty' in lib.installed) {
        return gradleProperty(root, lib.installed.gradleProperty);
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
            if (pkg?.name === c.packageName && pkg.version) {
                return {library: lib.id, version: pkg.version};
            }
        } else if (settings && rootProjectName(settings) === c.gradleProject) {
            return {
                library: lib.id,
                version: gradleProperty(root, c.versionProperty) ?? DEVELOP_VERSION
            };
        }
    }
    return null;
}

function rootProjectName(settings: string): string | null {
    return /^\s*rootProject\.name\s*=\s*['"]([^'"]+)['"]/m.exec(settings)?.[1] ?? null;
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
