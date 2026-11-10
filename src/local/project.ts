/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

/** The Hoist versions a project uses, as found on disk. */
export interface ProjectVersions {
    /** Installed `@xh/hoist` version, if any. */
    react: string | null;
    /** `hoistCoreVersion` from gradle.properties, if any. */
    core: string | null;
    /** Problems worth telling the developer about, e.g. dependencies not installed. */
    notes: string[];
}

/**
 * Find the Hoist versions of the project at `root`: the exact `@xh/hoist` version installed in
 * `client-app/node_modules` (or `node_modules`), and `hoistCoreVersion` from `gradle.properties`.
 * The installed version is used rather than the range in package.json, since that is the code the
 * app actually runs.
 */
export function detectProjectVersions(root: string): ProjectVersions {
    const ret: ProjectVersions = {react: null, core: null, notes: []},
        projectRoot = resolve(root);

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

    const props = join(projectRoot, 'gradle.properties');
    if (existsSync(props)) {
        const match = /^\s*hoistCoreVersion\s*[=:]\s*(\S+)\s*$/m.exec(readFileSync(props, 'utf8'));
        if (match) ret.core = match[1];
    }
    return ret;
}

/** True for a version with no released index: a snapshot, served from the `develop` index. */
export function isSnapshot(version: string): boolean {
    return /snapshot/i.test(version);
}

function readJson(path: string): any {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return null;
    }
}
