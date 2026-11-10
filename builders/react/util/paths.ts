/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * Path utilities for the hoist-react index builder.
 *
 * The builder indexes a hoist-react checkout given on the command line (see `setRepoRoot`), so it
 * can index any tag. Also provides safe path construction that prevents directory traversal
 * outside the checkout.
 */
import {existsSync, readFileSync} from 'node:fs';
import {resolve, dirname, sep} from 'node:path';

/** Cached repo root -- resolved once and reused. */
let cachedRepoRoot: string | undefined;

/** Cached hoist library version -- resolved once and reused. */
let cachedHoistVersion: string | undefined;

/** Options for the library being indexed. */
export interface LibraryOptions {
    /** Package name its imports start with, e.g. `@xh/hoist` or `@xh/hoist-chat-kit`. */
    importPrefix: string;
    /** Top-level folders that hold no published source, e.g. `test`. */
    excludeDirs: string[];
}

/** hoist-react's, unless {@link setLibraryOptions} names another library. */
let libraryOptions: LibraryOptions = {importPrefix: '@xh/hoist', excludeDirs: []};

/** Set the options for the library being indexed, before building. */
export function setLibraryOptions(options: LibraryOptions): void {
    libraryOptions = options;
}

export function getLibraryOptions(): LibraryOptions {
    return libraryOptions;
}

/**
 * Set the hoist-react checkout to index. Must hold hoist-react's `package.json` and, for type
 * resolution, its installed `node_modules`.
 */
export function setRepoRoot(path: string): void {
    const repoRoot = resolve(path);
    if (!existsSync(resolve(repoRoot, 'package.json'))) {
        throw new Error(`Not a library checkout: no package.json at ${repoRoot}`);
    }
    cachedRepoRoot = repoRoot;
}

/**
 * The hoist-react checkout being indexed: as set by {@link setRepoRoot}, else the
 * `HOIST_REACT_ROOT` env var.
 */
export function resolveRepoRoot(): string {
    if (!cachedRepoRoot) {
        const fromEnv = process.env.HOIST_REACT_ROOT;
        if (!fromEnv) {
            throw new Error(
                'No library checkout given - pass --root <dir> or set HOIST_REACT_ROOT.'
            );
        }
        setRepoRoot(fromEnv);
    }
    return cachedRepoRoot!;
}

/** Convert a filesystem path to POSIX (forward-slash) form. */
export function toPosixPath(p: string): string {
    return p.replace(/\\/g, '/');
}

/**
 * Repo root in POSIX (forward-slash) form, matching ts-morph's `getFilePath()`
 * convention, which always reports forward slashes on every platform.
 *
 * On Windows, {@link resolveRepoRoot} returns a backslash path (e.g.
 * `D:\hoist-react`) while ts-morph reports `D:/hoist-react/...`; comparing or
 * slicing the two directly fails, silently filtering out every source file and
 * yielding an empty symbol index. Use this whenever comparing against or
 * slicing a ts-morph source-file path (see `data/ts-registry.ts` and
 * `formatters/typescript.ts`). Filesystem access that stays within Node's
 * `path` APIs should keep using {@link resolveRepoRoot}.
 */
export function resolveRepoRootPosix(): string {
    return toPosixPath(resolveRepoRoot());
}

/**
 * True if a source file is library source to index. Excludes files outside the repo root and,
 * within it, dependencies, build output, this MCP sub-project, specs, and the CI reporter for
 * hoist-react's own tests - none of which ship. The test kit in `test-support/` ships as
 * `@xh/hoist/test-support`, so it is indexed.
 *
 * Tests the path relative to `repoRoot`, never the absolute path. In an app, the package root
 * itself sits under `node_modules`, and a folder above it may be named `build` or `docs-index`. A test
 * of the absolute path then rejects every file. The symbol indexer and the import path resolver
 * both filter with this function so that they always agree.
 *
 * @param filePath - absolute POSIX path, as ts-morph `getFilePath()` reports it.
 * @param repoRoot - repo root in POSIX form - see {@link resolveRepoRootPosix}.
 */
export function isLibrarySource(filePath: string, repoRoot: string): boolean {
    if (!filePath.startsWith(repoRoot + '/')) return false;
    const relPath = filePath.slice(repoRoot.length);
    return (
        !relPath.startsWith('/node_modules/') &&
        !relPath.includes('/build/') &&
        !relPath.includes('/docs-index/') &&
        // The stdio MCP server that releases before the move to Hoist Docs carried.
        !relPath.includes('/mcp/') &&
        !relPath.startsWith('/test-support/report/') &&
        !relPath.endsWith('.spec.ts') &&
        !libraryOptions.excludeDirs.some(dir => relPath.startsWith(`/${dir}/`))
    );
}

/**
 * Resolve the `@xh/hoist` library version from the repo root `package.json`.
 *
 * Used by the connectivity-check surfaces (`hoist-ping` tool, `hoist-docs ping`
 * CLI) so a sanity check also reports which hoist version is being indexed.
 * The result is cached after the first call.
 */
export function resolveHoistVersion(): string {
    if (cachedHoistVersion) return cachedHoistVersion;

    const pkgPath = resolve(resolveRepoRoot(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {version?: string};
    cachedHoistVersion = pkg.version ?? 'unknown';
    return cachedHoistVersion;
}

//------------------------------------------------------------------
// Consuming package (app root) and its dependencies
//------------------------------------------------------------------

/** The subset of a package.json the tools read. */
export interface PackageJson {
    name?: string;
    version?: string;
    description?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    hoist?: {docRegistry?: string};
}

/** Read `<dir>/package.json`, or return null if it is missing or unreadable. */
export function readPackageJson(dir: string): PackageJson | null {
    const path = resolve(dir, 'package.json');
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Resolve the root of the package that consumes `@xh/hoist` - the anchor for companion library
 * discovery. The server cannot find companion libraries from its own location, because under
 * pnpm `@xh/hoist` lives in the `.pnpm` store and does not depend on them.
 *
 * Checks, in order:
 *  1. The `HOIST_MCP_APP_ROOT` env var, if set. Used as given.
 *  2. `cwd` and `cwd/client-app` (the standard Hoist app layout), then the same pair in each
 *     parent folder. The first package.json that is `@xh/hoist` or depends on it wins, so a run
 *     from deep inside an app (e.g. `client-app/src`) still finds it.
 *  3. Else the first package.json in `cwd` or `cwd/client-app`.
 *
 * Returns null when no package.json is found. Params exist for specs - callers pass none.
 */
export function resolveAppRoot(
    cwd: string = process.cwd(),
    env: Record<string, string | undefined> = process.env
): string | null {
    if (env.HOIST_MCP_APP_ROOT) return resolve(cwd, env.HOIST_MCP_APP_ROOT);

    const start = resolve(cwd);
    let fallback: string | null = null;
    for (let dir = start; ; dir = dirname(dir)) {
        for (const candidate of [dir, resolve(dir, 'client-app')]) {
            const pkg = readPackageJson(candidate);
            if (!pkg) continue;
            if (usesHoist(pkg)) return candidate;
            if (dir === start) fallback ??= candidate;
        }
        if (dirname(dir) === dir) return fallback;
    }
}

/** True if `pkg` is `@xh/hoist` or depends on it. */
function usesHoist(pkg: PackageJson): boolean {
    const deps = {...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies};
    return pkg.name === '@xh/hoist' || '@xh/hoist' in deps;
}

/**
 * Find an installed package by walking up from `fromDir` through each `node_modules/<name>`,
 * as Node does. Returns its `node_modules` path, which under pnpm is a link into the store, or
 * null if not installed. Reads the folder directly rather than `require.resolve()`, which fails
 * for packages whose `exports` map hides `package.json`.
 */
export function findInstalledPackage(fromDir: string, name: string): string | null {
    let dir = resolve(fromDir);
    while (true) {
        const candidate = resolve(dir, 'node_modules', name);
        if (existsSync(resolve(candidate, 'package.json'))) return candidate;
        const parent = dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/**
 * Resolve a relative path within the repo root, with traversal protection.
 *
 * Rejects any `relativePath` containing `..` segments and verifies that the
 * resolved absolute path falls within (or equals) `repoRoot`.
 *
 * @throws Error if path traversal is detected.
 */
export function resolveDocPath(repoRoot: string, relativePath: string): string {
    if (relativePath.includes('..')) {
        throw new Error(`Path traversal detected: "${relativePath}" contains '..' segments`);
    }

    const resolved = resolve(repoRoot, relativePath);

    if (resolved !== repoRoot && !resolved.startsWith(repoRoot + sep)) {
        throw new Error(`Path traversal detected: "${relativePath}" resolves outside repo root`);
    }

    return resolved;
}
