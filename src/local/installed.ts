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
    /** True for packages trusted to give agent instructions: `@xh`, and the app's direct dependencies. */
    trusted: boolean;
}

/**
 * Find every installed package that ships a Hoist Docs index, declared in its `package.json`:
 *
 *   "hoistDocs": {"id": "react", "index": "hoist-docs/index.json.gz"}
 *
 * Looks at the direct entries of `client-app/node_modules` and `node_modules` under `root` (and
 * their `@scope/` folders), the first finding of a package winning. Two packages claiming the same
 * id keep the `@xh` one, else a trusted one, else the first, with a note.
 *
 * A package's index may give the agent instructions if it is XH's own, or if the app depends on it
 * directly, in the `package.json` beside that `node_modules`. A package that arrives only through
 * another is served, but its instructions are dropped, so a library several layers down cannot
 * steer the agent.
 */
export function findInstalledIndexes(root: string): {indexes: InstalledIndex[]; notes: string[]} {
    const projectRoot = resolve(root),
        notes: string[] = [],
        byPackage = new Map<string, InstalledIndex>(),
        xhPackages = new Set<InstalledIndex>();

    for (const dir of [
        join(projectRoot, 'client-app', 'node_modules'),
        join(projectRoot, 'node_modules')
    ]) {
        const direct = directDependencies(dirname(dir));
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
            // Trust goes by the folder the package is installed in, which is what package.json
            // names, not by the name a package gives itself in its own manifest.
            const folder = relative(dir, pkgDir).split(sep).join('/'),
                isXh = folder.startsWith(XH_SCOPE),
                idx: InstalledIndex = {
                    libraryId: decl.id,
                    version: pkg.version,
                    path,
                    packageName: pkg.name,
                    trusted: isXh || direct.has(folder)
                };
            byPackage.set(pkg.name, idx);
            if (isXh) xhPackages.add(idx);
        }
    }

    const byId = new Map<string, InstalledIndex>();
    for (const idx of byPackage.values()) {
        const prev = byId.get(idx.libraryId);
        if (!prev) {
            byId.set(idx.libraryId, idx);
            continue;
        }
        const rank = (i: InstalledIndex) => (xhPackages.has(i) ? 2 : i.trusted ? 1 : 0),
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
/** XH's npm scope, whose packages are always trusted. */
const XH_SCOPE = '@xh/';

/** The packages a `package.json` in `dir` depends on directly, of every kind, by install folder. */
function directDependencies(dir: string): Set<string> {
    const pkg = readJson(join(dir, 'package.json'));
    return new Set(
        ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap(k =>
            Object.keys(pkg?.[k] ?? {})
        )
    );
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
