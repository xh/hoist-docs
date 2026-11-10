/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

/** The Hoist versions a project uses, as found on disk. */
export interface ProjectVersions {
    /** Installed `@xh/hoist` version, if any. */
    react: string | null;
    /** `hoistCoreVersion` from gradle.properties, if any. */
    core: string | null;
    /** Problems worth telling the developer about, e.g. dependencies not installed. */
    notes: string[];
    /** The library, if `root` is a checkout of hoist-react or hoist-core itself. */
    checkout?: 'react' | 'core';
}

/** Version given to a library with no version of its own in a project: its `develop` index. */
export const DEVELOP_VERSION = 'develop';

/**
 * Find the Hoist versions of the project at `root`: the exact `@xh/hoist` version installed in
 * `client-app/node_modules` (or `node_modules`), and `hoistCoreVersion` from `gradle.properties`.
 * The installed version is used rather than the range in package.json, since that is the code the
 * app actually runs.
 *
 * A checkout of hoist-react or hoist-core itself is served its own version (a snapshot, so the
 * `develop` index) plus the other library's `develop` index.
 */
export function detectProjectVersions(root: string): ProjectVersions {
    const ret: ProjectVersions = {react: null, core: null, notes: []},
        projectRoot = resolve(root);

    const checkout = detectCheckout(projectRoot);
    if (checkout) {
        ret.checkout = checkout.library;
        ret.react = checkout.library === 'react' ? checkout.version : DEVELOP_VERSION;
        ret.core = checkout.library === 'core' ? checkout.version : DEVELOP_VERSION;
        return ret;
    }

    for (const dir of [join(projectRoot, 'client-app'), projectRoot]) {
        const installed = readJson(join(dir, 'node_modules', '@xh', 'hoist', 'package.json'));
        if (installed?.version) {
            ret.react = installed.version;
            break;
        }
        const pkg = readJson(join(dir, 'package.json')),
            deps = {...pkg?.dependencies, ...pkg?.devDependencies};
        if (deps['@xh/hoist']) {
            ret.notes.push(
                `${join(dir, 'package.json')} depends on @xh/hoist, but it is not installed - run your package manager's install, then restart.`
            );
            break;
        }
    }

    const props = readText(join(projectRoot, 'gradle.properties'));
    if (props) {
        const match = /^\s*hoistCoreVersion\s*[=:]\s*(\S+)\s*$/m.exec(props);
        if (match) ret.core = match[1];
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
/** The library and version of a hoist-react or hoist-core checkout at `root`, if it is one. */
function detectCheckout(root: string): {library: 'react' | 'core'; version: string} | null {
    const pkg = readJson(join(root, 'package.json'));
    if (pkg?.name === '@xh/hoist' && pkg.version) return {library: 'react', version: pkg.version};

    const settings = readText(join(root, 'settings.gradle'));
    if (settings && /^\s*rootProject\.name\s*=\s*['"]hoist-core['"]/m.test(settings)) {
        const version = /^\s*xhReleaseVersion\s*[=:]\s*(\S+)\s*$/m.exec(
            readText(join(root, 'gradle.properties')) ?? ''
        )?.[1];
        return {library: 'core', version: version ?? DEVELOP_VERSION};
    }
    return null;
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
