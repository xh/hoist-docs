/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * Build and publish index packages for library releases and `develop`. Run by
 * `.github/workflows/publish-indexes.yml`, and locally with --dry-run.
 *
 *   node scripts/publish-indexes.ts [--library <id>] [--tag v90.0.0 ...] [--develop]
 *       [--rebuild] [--dry-run] [--repo <id>=<dir> ...] [--work <dir>]
 *
 * Libraries are the built-in ones in `src/libraries.ts`. With no --tag or --develop, handles every
 * release tag from each library's floor (hoist-react v83, hoist-core v37, hoist-chat-kit v1) that
 * has no published index, plus `develop` if it changed. --rebuild republishes the given
 * tags as new revisions, after a builder fix. --repo uses an existing clone instead of cloning
 * from GitHub. --dry-run builds and packs but does not publish.
 *
 * Building a tag: the library is checked out at the tag in a git worktree; a TypeScript library's
 * dependencies are installed there with the package manager the tag declares (via corepack); the
 * builder runs with --version set from the tag, since tagged commits carry the next snapshot
 * version. See "Index format and build pipeline" in docs/design.md.
 */
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

import {compareVersions} from '../src/IndexStore.ts';
import {LIBRARIES, type LibraryDef} from '../src/libraries.ts';
import {DEVELOP_TAG, nextRevision, pickRevision} from '../src/local/packages.ts';
import {packIndex} from './pack-index.ts';

type LibrarySpec = LibraryDef;

const ROOT = resolve(import.meta.dirname, '..');

interface Options {
    libraries: LibrarySpec[];
    tags: string[];
    develop: boolean;
    all: boolean;
    rebuild: boolean;
    dryRun: boolean;
    repos: Record<string, string>;
    work: string;
}

function main(): void {
    const opts = parseArgs(process.argv.slice(2)),
        outDir = join(opts.work, 'packages');
    mkdirSync(outDir, {recursive: true});
    let failures = 0;

    for (const lib of opts.libraries) {
        const pkg = lib.indexPackage,
            repo = ensureRepo(lib, opts),
            published = publishedVersions(pkg);

        const tags = opts.all ? releaseTags(repo, lib) : opts.tags;
        for (const tag of tags) {
            const release = tag.replace(/^v/, ''),
                existing = pickRevision(published, release);
            if (existing && !opts.rebuild) continue;
            const pkgVersion = existing ? nextRevision(published, release) : release;
            try {
                const index = buildAt(lib, repo, tag, release, opts);
                publish(
                    packIndex(index, outDir, pkgVersion),
                    pkg,
                    pkgVersion,
                    latestTag(published, release),
                    opts
                );
            } catch (e) {
                failures++;
                console.error(`FAILED ${lib.id} ${tag}: ${(e as Error).message}`);
            }
        }

        if (opts.develop || opts.all) {
            try {
                publishDevelop(lib, repo, pkg, outDir, opts);
            } catch (e) {
                failures++;
                console.error(`FAILED ${lib.id} develop: ${(e as Error).message}`);
            }
        }
    }
    if (failures) process.exit(1);
}

//------------------------
// Building
//------------------------
/** Build the index for `ref` of a library, returning the index file path. */
function buildAt(
    lib: LibrarySpec,
    repo: string,
    ref: string,
    version: string,
    opts: Options
): string {
    const wt = join(opts.work, 'worktrees', `${lib.id}-${ref.replace(/[^\w.-]/g, '_')}`),
        out = join(opts.work, 'indexes');
    rmSync(wt, {recursive: true, force: true});
    git(repo, 'worktree', 'prune');
    git(repo, 'worktree', 'add', '--detach', '--force', wt, ref);
    try {
        console.log(`Building ${lib.id} ${ref} as ${version}`);
        if (lib.builder === 'typescript') {
            const pm =
                JSON.parse(readFileSync(join(wt, 'package.json'), 'utf8')).packageManager ?? 'pnpm';
            run(
                pm.startsWith('yarn')
                    ? ['corepack', 'yarn', 'install', '--frozen-lockfile']
                    : ['corepack', 'pnpm', 'install', '--frozen-lockfile'],
                wt
            );
            run(
                [
                    'node',
                    join(ROOT, 'builders/react/cli/build-index.ts'),
                    '--root',
                    wt,
                    '--library',
                    lib.id,
                    '--version',
                    version,
                    '--out',
                    out,
                    '--gzip'
                ],
                ROOT,
                {HOIST_MCP_QUIET: '1', HOIST_MCP_NO_CACHE: '1'}
            );
        } else {
            run(
                [
                    join(ROOT, 'builders/core/build-index.sh'),
                    '--root',
                    wt,
                    '--version',
                    version,
                    '--out',
                    out,
                    '--gzip'
                ],
                ROOT
            );
        }
        return join(out, `${lib.id}-${version}.json.gz`);
    } finally {
        git(repo, 'worktree', 'remove', '--force', wt);
    }
}

/** Build and publish `develop` if its head is not already published. */
function publishDevelop(
    lib: LibrarySpec,
    repo: string,
    pkg: string,
    outDir: string,
    opts: Options
): void {
    git(repo, 'fetch', '--quiet', 'origin', 'develop');
    const sha = git(repo, 'rev-parse', '--short=10', 'origin/develop'),
        current = distTagVersion(pkg, DEVELOP_TAG);
    if (current?.endsWith(`.${sha}`) && !opts.rebuild) {
        console.log(`${lib.id} develop ${sha} already published as ${current}`);
        return;
    }

    const snapshot = snapshotVersion(lib, repo, 'origin/develop'),
        base = semverBase(snapshot),
        stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12),
        pkgVersion = `${base}-develop.${stamp}.${sha}`,
        index = buildAt(lib, repo, 'origin/develop', snapshot, opts);
    publish(packIndex(index, outDir, pkgVersion), pkg, pkgVersion, DEVELOP_TAG, opts);
}

/** The snapshot version a ref declares: package.json for npm libraries, gradle.properties for core. */
function snapshotVersion(lib: LibrarySpec, repo: string, ref: string): string {
    if ('packageName' in lib.checkout) {
        return JSON.parse(git(repo, 'show', `${ref}:package.json`)).version;
    }
    const prop = lib.checkout.versionProperty,
        m = new RegExp(`^${prop}=(\\S+)`, 'm').exec(git(repo, 'show', `${ref}:gradle.properties`));
    if (!m) throw new Error(`No ${prop} in gradle.properties`);
    return m[1];
}

/** `91.0.0-SNAPSHOT` to `91.0.0`; `45.0-SNAPSHOT` to `45.0.0`. */
function semverBase(version: string): string {
    const nums = version.replace(/-.*$/, '').split('.');
    while (nums.length < 3) nums.push('0');
    return nums.slice(0, 3).join('.');
}

//------------------------
// Publishing
//------------------------
function publish(tgz: string, pkg: string, version: string, distTag: string, opts: Options): void {
    if (opts.dryRun) {
        console.log(`[dry run] would publish ${pkg}@${version} (tag ${distTag}) from ${tgz}`);
        return;
    }
    run(['npm', 'publish', tgz, '--access', 'public', '--tag', distTag], ROOT);
    console.log(`Published ${pkg}@${version} (tag ${distTag})`);
}

/**
 * The dist-tag for a release: `latest` when it is the newest release, else `backfill`. npm needs
 * a tag on every publish, and `latest` must not move backwards when older releases are filled in.
 */
function latestTag(published: string[], release: string): string {
    const releases = published.filter(v => /^\d+\.\d+\.\d+$/.test(v));
    return releases.every(v => compareVersions(v, release) < 0) ? 'latest' : 'backfill';
}

function publishedVersions(pkg: string): string[] {
    try {
        const out = execFileSync('npm', ['view', pkg, 'versions', '--json'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }).trim();
        const parsed = JSON.parse(out || '[]');
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
        if (String((e as {stderr?: string}).stderr).includes('E404')) return [];
        throw e;
    }
}

function distTagVersion(pkg: string, tag: string): string | null {
    try {
        const out = execFileSync('npm', ['view', pkg, 'dist-tags', '--json'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
        return (JSON.parse(out.trim() || '{}') as Record<string, string>)[tag] ?? null;
    } catch {
        return null;
    }
}

//------------------------
// Repos and processes
//------------------------
function ensureRepo(lib: LibrarySpec, opts: Options): string {
    if (opts.repos[lib.id]) return resolve(opts.repos[lib.id]);
    const dir = join(opts.work, 'repos', lib.id);
    if (!existsSync(dir)) {
        mkdirSync(join(opts.work, 'repos'), {recursive: true});
        run(['git', 'clone', '--quiet', '--filter=blob:none', lib.repo, dir], opts.work);
    } else {
        git(dir, 'fetch', '--quiet', '--tags', 'origin');
    }
    return dir;
}

/** Release tags (`vX.Y.Z`) at or above the library's floor, oldest first. */
function releaseTags(repo: string, lib: LibrarySpec): string[] {
    return git(repo, 'tag', '--list', 'v*')
        .split('\n')
        .filter(t => /^v\d+\.\d+\.\d+$/.test(t) && compareVersions(t.slice(1), lib.floor) >= 0)
        .sort((a, b) => compareVersions(a.slice(1), b.slice(1)));
}

function git(repo: string, ...args: string[]): string {
    return execFileSync('git', args, {cwd: repo, encoding: 'utf8'}).trim();
}

function run(cmd: string[], cwd: string, env: Record<string, string> = {}): void {
    const res = spawnSync(cmd[0], cmd.slice(1), {
        cwd,
        stdio: 'inherit',
        env: {...process.env, ...env}
    });
    if (res.status !== 0) throw new Error(`${cmd.join(' ')} exited with ${res.status}`);
}

function parseArgs(argv: string[]): Options {
    const opts: Options = {
        libraries: LIBRARIES,
        tags: [],
        develop: false,
        all: false,
        rebuild: false,
        dryRun: false,
        repos: {},
        work: join(tmpdir(), 'hoist-docs-publish')
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--library') {
            const id = argv[++i];
            opts.libraries = LIBRARIES.filter(l => l.id === id);
        } else if (a === '--tag') opts.tags.push(argv[++i]);
        else if (a === '--develop') opts.develop = true;
        else if (a === '--rebuild') opts.rebuild = true;
        else if (a === '--dry-run') opts.dryRun = true;
        else if (a === '--work') opts.work = resolve(argv[++i]);
        else if (a === '--repo') {
            const [id, dir] = argv[++i].split('=');
            opts.repos[id] = dir;
        } else throw new Error(`Unknown argument: ${a}`);
    }
    opts.all = !opts.tags.length && !opts.develop;
    if (!opts.libraries.length) {
        throw new Error(`--library must be one of ${LIBRARIES.map(l => l.id).join(', ')}`);
    }
    mkdirSync(opts.work, {recursive: true});
    return opts;
}

if (import.meta.main) main();
