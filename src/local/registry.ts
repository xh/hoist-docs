/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {execFile} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';

const run = promisify(execFile);

/** The npm registry operations the local tool needs. Injectable for tests. */
export interface Registry {
    /** The version a dist-tag points at, or null. */
    distTag(pkg: string, tag: string): Promise<string | null>;
    /** The package tarball (.tgz) for one version. */
    pack(pkg: string, version: string): Promise<Buffer>;
}

/**
 * Registry access through the developer's own `npm` command, so their `.npmrc` registry,
 * credentials, proxy and certificates apply unchanged - including an organization's Artifactory.
 */
export class NpmRegistry implements Registry {
    async distTag(pkg: string, tag: string): Promise<string | null> {
        const out = await npmView(pkg, 'dist-tags');
        return out == null
            ? null
            : ((JSON.parse(out || '{}') as Record<string, string>)[tag] ?? null);
    }

    async pack(pkg: string, version: string): Promise<Buffer> {
        // Scripts off: a registry tarball runs none, and no other kind of spec should get here.
        const dir = mkdtempSync(join(tmpdir(), 'hoist-docs-pack-'));
        try {
            const out = await npm([
                    'pack',
                    `${pkg}@${version}`,
                    '--json',
                    '--ignore-scripts',
                    '--pack-destination',
                    dir
                ]),
                [{filename}] = JSON.parse(out) as Array<{filename: string}>;
            return readFileSync(join(dir, filename));
        } finally {
            rmSync(dir, {recursive: true, force: true});
        }
    }
}

/** `npm view <pkg> <field> --json`, or null if the package is not published. */
async function npmView(pkg: string, field: string): Promise<string | null> {
    try {
        return await npm(['view', pkg, field, '--json']);
    } catch (e) {
        if (/\bE404\b/.test(String(e))) return null;
        throw e;
    }
}

async function npm(args: string[]): Promise<string> {
    const win = process.platform === 'win32';
    try {
        const {stdout} = await run(win ? 'npm.cmd' : 'npm', args, {
            shell: win,
            maxBuffer: 64 * 1024 * 1024
        });
        return stdout.trim();
    } catch (e) {
        const err = e as {stderr?: string; message: string};
        throw new Error(`npm ${args.join(' ')} failed: ${(err.stderr || err.message).trim()}`, {
            cause: e
        });
    }
}
