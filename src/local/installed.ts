/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';

/** An index shipped inside an installed npm package. */
export interface InstalledIndex {
    libraryId: string;
    version: string;
    path: string;
    packageName: string;
    /** True for packages whose index may carry agent instructions: `@xh`, and those the app lists. */
    trusted: boolean;
}

/** XH's scope, whose packages are always trusted to give the agent instructions. */
const XH_SCOPE = '@xh/';

/**
 * Find every installed package that ships a Hoist Docs index, declared in its `package.json`:
 *
 *   "hoistDocs": {"id": "react", "index": "hoist-docs/index.json.gz"}
 *
 * Looks at the direct entries of `client-app/node_modules` and `node_modules` under `root` (and
 * their `@scope/` folders), the first finding of a package winning. Two packages claiming the same
 * id keep the `@xh` one, else a trusted one, else the first, with a note.
 *
 * An index may give the agent instructions if its package is XH's, or one the app lists in the
 * `package.json` beside that `node_modules`. Trust goes by the folder a package is installed in,
 * which is what `package.json` names, not by the name the package gives itself.
 */
export function findInstalledIndexes(root: string): {indexes: InstalledIndex[]; notes: string[]} {
    const projectRoot = resolve(root),
        notes: string[] = [],
        byPackage = new Map<string, InstalledIndex>();

    for (const dir of [
        join(projectRoot, 'client-app', 'node_modules'),
        join(projectRoot, 'node_modules')
    ]) {
        const listed = dependencyNames(dirname(dir));
        for (const pkgDir of packageDirs(dir)) {
            const pkg = readJson(join(pkgDir, 'package.json')),
                decl = pkg?.hoistDocs;
            if (!pkg?.name || !decl || byPackage.has(pkg.name)) continue;
            if (typeof decl.id !== 'string' || typeof decl.index !== 'string') {
                notes.push(
                    `${pkg.name} has a malformed "hoistDocs" entry - expected {"id", "index"}.`
                );
                continue;
            }
            const path = resolve(pkgDir, decl.index);
            if (!path.startsWith(resolve(pkgDir) + sep)) {
                notes.push(
                    `${pkg.name} declares a Hoist Docs index outside its package - ignored.`
                );
                continue;
            }
            if (!existsSync(path)) {
                notes.push(
                    `${pkg.name} ${pkg.version} declares a Hoist Docs index at ${decl.index}, but it is missing.`
                );
                continue;
            }
            const folder = relative(dir, pkgDir).split(sep).join('/');
            byPackage.set(pkg.name, {
                libraryId: decl.id,
                version: pkg.version,
                path,
                packageName: pkg.name,
                trusted: folder.startsWith(XH_SCOPE) || listed.has(folder)
            });
        }
    }

    const byId = new Map<string, InstalledIndex>();
    for (const idx of byPackage.values()) {
        const prev = byId.get(idx.libraryId);
        if (!prev) {
            byId.set(idx.libraryId, idx);
            continue;
        }
        const rank = (i: InstalledIndex) =>
                i.trusted ? (i.packageName.startsWith(XH_SCOPE) ? 2 : 1) : 0,
            keep = rank(idx) > rank(prev) ? idx : prev,
            drop = keep === prev ? idx : prev;
        byId.set(idx.libraryId, keep);
        notes.push(
            `${drop.packageName} and ${keep.packageName} both ship a Hoist Docs index with id '${idx.libraryId}' - serving ${keep.packageName}'s.`
        );
    }
    return {indexes: [...byId.values()], notes};
}

//------------------------
// Implementation
//------------------------
/** Every dependency a `package.json` in `dir` lists, of any kind. */
function dependencyNames(dir: string): Set<string> {
    const pkg = readJson(join(dir, 'package.json')),
        kinds = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
    return new Set(kinds.flatMap(k => Object.keys(pkg?.[k] ?? {})));
}

/** Package folders directly in a node_modules folder, including one level into `@scope/` folders. */
function packageDirs(nodeModules: string): string[] {
    const ret: string[] = [];
    for (const name of list(nodeModules)) {
        if (name.startsWith('.')) continue;
        if (name.startsWith('@')) {
            for (const sub of list(join(nodeModules, name))) ret.push(join(nodeModules, name, sub));
        } else {
            ret.push(join(nodeModules, name));
        }
    }
    return ret;
}

function list(dir: string): string[] {
    try {
        return readdirSync(dir);
    } catch {
        return [];
    }
}

function readJson(path: string): any {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return null;
    }
}
