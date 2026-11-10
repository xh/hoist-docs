/**
 * Package one index file as an npm index package tarball (see "Index format and build pipeline"
 * in docs/design.md).
 *
 *   node scripts/pack-index.ts <index.json[.gz]> [--pkg-version <v>] [--out <dir>]
 *
 * The package is named for the index's library and versioned as its library version, unless
 * --pkg-version gives a revision (`90.0.0-r2`) or a develop build version. Prints the tarball
 * path.
 */
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {gzipSync} from 'node:zlib';

import {LibraryIndex} from '../src/index/LibraryIndex.ts';
import {INDEX_PACKAGES} from '../src/local/packages.ts';

/** Pack `indexPath` into `outDir`, returning the tarball's path. */
export function packIndex(indexPath: string, outDir: string, pkgVersion?: string): string {
    const index = LibraryIndex.readJson(indexPath),
        {id, name, version} = index.library,
        pkg = INDEX_PACKAGES[id];
    if (!pkg) throw new Error(`No index package for library '${id}'`);

    const dir = mkdtempSync(join(tmpdir(), 'hoist-docs-index-pkg-'));
    try {
        const raw = readFileSync(indexPath);
        writeFileSync(join(dir, 'index.json.gz'), indexPath.endsWith('.gz') ? raw : gzipSync(raw));
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                {
                    name: pkg,
                    version: pkgVersion ?? version,
                    description: `Hoist Docs index for ${name} ${version}: docs, symbols and members, read by @xh/hoist-docs.`,
                    license: 'Apache-2.0',
                    repository: {type: 'git', url: 'git+https://github.com/xh/hoist-docs.git'},
                    files: ['index.json.gz'],
                    hoistDocs: {library: id, version, gitSha: index.library.gitSha ?? null}
                },
                null,
                2
            )
        );
        mkdirSync(outDir, {recursive: true});
        const out = execFileSync('npm', ['pack', '--json', '--pack-destination', resolve(outDir)], {
                cwd: dir,
                encoding: 'utf8'
            }),
            [{filename}] = JSON.parse(out) as Array<{filename: string}>;
        return join(resolve(outDir), filename);
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
}

if (import.meta.main) {
    const args = process.argv.slice(2),
        opt = (name: string) => {
            const i = args.indexOf(name);
            return i >= 0 ? args[i + 1] : undefined;
        },
        indexPath = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
    if (!indexPath) {
        console.error(
            'Usage: node scripts/pack-index.ts <index.json[.gz]> [--pkg-version <v>] [--out <dir>]'
        );
        process.exit(1);
    }
    console.log(packIndex(indexPath, opt('--out') ?? '.', opt('--pkg-version')));
}
