/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';

import {beforeAll, describe, expect, it} from 'vitest';

import {docsFromCheckout} from '../src/local/checkout.ts';
import {IndexResolver} from '../src/local/IndexResolver.ts';
import {INDEX_FILE_IN_PACKAGE, nextRevision, pickRevision} from '../src/local/packages.ts';
import {detectProjectVersions, isSnapshot} from '../src/local/project.ts';
import type {Registry} from '../src/local/registry.ts';
import {readFromTgz} from '../src/local/tar.ts';
import {packIndex} from '../scripts/pack-index.ts';
import {coreIndex, reactIndex, writeIndexDir} from './fixtures.ts';

const ROOT = resolve(import.meta.dirname, '..');

/** A registry over package tarballs, recording calls. */
class FakeRegistry implements Registry {
    readonly tarballs = new Map<string, Buffer>();
    readonly tags = new Map<string, string>();
    calls: string[] = [];
    failing = false;

    add(pkg: string, version: string, tgz: Buffer): void {
        this.tarballs.set(`${pkg}@${version}`, tgz);
    }

    async versions(pkg: string): Promise<string[]> {
        this.call(`versions ${pkg}`);
        return [...this.tarballs.keys()]
            .filter(k => k.startsWith(pkg + '@'))
            .map(k => k.slice(pkg.length + 1));
    }

    async distTag(pkg: string, tag: string): Promise<string | null> {
        this.call(`distTag ${pkg} ${tag}`);
        return this.tags.get(`${pkg}#${tag}`) ?? null;
    }

    async pack(pkg: string, version: string): Promise<Buffer> {
        this.call(`pack ${pkg}@${version}`);
        return this.tarballs.get(`${pkg}@${version}`)!;
    }

    private call(desc: string): void {
        if (this.failing) throw new Error('offline');
        this.calls.push(desc);
    }
}

/** Tarballs of the synthetic indexes, as published packages. */
function packFixtures(): Record<string, Buffer> {
    const dir = writeIndexDir({
            'react-90.0.0.json': reactIndex('90.0.0'),
            'react-91.0.0-SNAPSHOT.json': reactIndex('91.0.0-SNAPSHOT'),
            'core-44.0.0.json': coreIndex('44.0.0')
        }),
        out = mkdtempSync(join(tmpdir(), 'hoist-docs-tgz-')),
        pack = (file: string, v?: string) => readFileSync(packIndex(join(dir, file), out, v));
    return {
        react90: pack('react-90.0.0.json'),
        react90r2: pack('react-90.0.0.json', '90.0.0-r2'),
        reactDevelop: pack('react-91.0.0-SNAPSHOT.json', '91.0.0-develop.202611100000.abc'),
        core44: pack('core-44.0.0.json')
    };
}

describe('project versions', () => {
    it('reads the installed @xh/hoist and hoistCoreVersion', () => {
        const root = mkdtempSync(join(tmpdir(), 'hoist-app-'));
        mkdirSync(join(root, 'client-app/node_modules/@xh/hoist'), {recursive: true});
        writeFileSync(
            join(root, 'client-app/package.json'),
            JSON.stringify({dependencies: {'@xh/hoist': '^90.0.0'}})
        );
        writeFileSync(
            join(root, 'client-app/node_modules/@xh/hoist/package.json'),
            JSON.stringify({version: '90.1.2'})
        );
        writeFileSync(join(root, 'gradle.properties'), 'xhAppCode=app\nhoistCoreVersion=44.0.0\n');
        expect(detectProjectVersions(root)).toEqual({react: '90.1.2', core: '44.0.0', notes: []});
    });

    it('notes a dependency that is not installed', () => {
        const root = mkdtempSync(join(tmpdir(), 'hoist-app-'));
        mkdirSync(join(root, 'client-app'));
        writeFileSync(
            join(root, 'client-app/package.json'),
            JSON.stringify({dependencies: {'@xh/hoist': '^90.0.0'}})
        );
        const v = detectProjectVersions(root);
        expect(v.react).toBeNull();
        expect(v.notes[0]).toContain('not installed');
    });

    it('treats snapshots as develop', () => {
        expect(isSnapshot('91.0.0-SNAPSHOT')).toBe(true);
        expect(isSnapshot('90.0.0')).toBe(false);
    });
});

describe('package revisions', () => {
    it('picks the highest revision of a release', () => {
        const published = ['89.0.0', '90.0.0', '90.0.0-r2', '90.0.0-r10', '91.0.0-develop.1.abc'];
        expect(pickRevision(published, '90.0.0')).toBe('90.0.0-r10');
        expect(pickRevision(published, '89.0.0')).toBe('89.0.0');
        expect(pickRevision(published, '88.0.0')).toBeNull();
        expect(nextRevision(published, '90.0.0')).toBe('90.0.0-r11');
        expect(nextRevision(published, '89.0.0')).toBe('89.0.0-r2');
        expect(nextRevision(published, '92.0.0')).toBe('92.0.0');
    });
});

describe('IndexResolver', () => {
    let tgz: Record<string, Buffer>;
    beforeAll(() => {
        tgz = packFixtures();
    }, 60_000);

    function setup() {
        const registry = new FakeRegistry(),
            cacheDir = mkdtempSync(join(tmpdir(), 'hoist-docs-cache-'));
        let now = 1_000_000;
        const resolver = new IndexResolver(registry, cacheDir, () => now);
        return {registry, resolver, cacheDir, advance: (ms: number) => (now += ms)};
    }

    const libraryVersion = (path: string) =>
        JSON.parse(gunzipSync(readFileSync(path)).toString()).library.version;

    it('index packages hold the index file', () => {
        const index = readFromTgz(tgz.core44, INDEX_FILE_IN_PACKAGE);
        expect(JSON.parse(gunzipSync(index!).toString()).library).toMatchObject({
            id: 'core',
            version: '44.0.0'
        });
    });

    it('fetches the highest revision once, then serves it from the cache', async () => {
        const {registry, resolver} = setup();
        registry.add('@xh/hoist-react-docs-index', '90.0.0', tgz.react90);
        registry.add('@xh/hoist-react-docs-index', '90.0.0-r2', tgz.react90r2);

        const path = await resolver.resolve('react', '90.0.0');
        expect(path).toMatch(/hoist-react-docs-index-90\.0\.0-r2\.json\.gz$/);
        expect(libraryVersion(path)).toBe('90.0.0');
        expect(registry.calls).toEqual([
            'versions @xh/hoist-react-docs-index',
            'pack @xh/hoist-react-docs-index@90.0.0-r2'
        ]);

        registry.calls = [];
        expect(await resolver.resolve('react', '90.0.0')).toBe(path);
        expect(registry.calls).toEqual([]);
    });

    it('rechecks daily, picking up a new revision, and falls back to the cache offline', async () => {
        const {registry, resolver, advance} = setup();
        registry.add('@xh/hoist-react-docs-index', '90.0.0', tgz.react90);
        const first = await resolver.resolve('react', '90.0.0');

        advance(25 * 3600_000);
        registry.add('@xh/hoist-react-docs-index', '90.0.0-r2', tgz.react90r2);
        expect(await resolver.resolve('react', '90.0.0')).toMatch(/90\.0\.0-r2\.json\.gz$/);

        advance(25 * 3600_000);
        registry.failing = true;
        expect(await resolver.resolve('react', '90.0.0')).toMatch(/90\.0\.0-r2\.json\.gz$/);
        expect(first).toMatch(/90\.0\.0\.json\.gz$/);
    });

    it('serves snapshots from the develop index', async () => {
        const {registry, resolver} = setup();
        registry.add(
            '@xh/hoist-react-docs-index',
            '91.0.0-develop.202611100000.abc',
            tgz.reactDevelop
        );
        registry.tags.set('@xh/hoist-react-docs-index#develop', '91.0.0-develop.202611100000.abc');
        const path = await resolver.resolve('react', '91.0.0-SNAPSHOT');
        expect(libraryVersion(path)).toBe('91.0.0-SNAPSHOT');
    });

    it('explains a release with no index', async () => {
        const {resolver} = setup();
        await expect(resolver.resolve('core', '30.0.0')).rejects.toThrow(
            /No index published for core 30\.0\.0/
        );
    });
});

describe('hoist-docs command', () => {
    /** Run the CLI from source, feeding it stdin lines; resolves with stdout lines. */
    function runCli(args: string[], input: string[], env: Record<string, string> = {}) {
        return new Promise<{code: number | null; out: any[]; err: string}>(done => {
            const child = spawn(process.execPath, [join(ROOT, 'src/cli.ts'), ...args], {
                env: {...process.env, ...env}
            });
            let out = '',
                err = '';
            child.stdout.on('data', d => (out += d));
            child.stderr.on('data', d => (err += d));
            child.on('close', code =>
                done({
                    code,
                    out: out.trim()
                        ? out
                              .trim()
                              .split('\n')
                              .map(l => JSON.parse(l))
                        : [],
                    err
                })
            );
            child.stdin.end(input.map(l => l + '\n').join(''));
        });
    }

    const initialize = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {protocolVersion: '2025-06-18', clientInfo: {name: 'spec'}}
        }),
        ping = JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {name: 'hoist-ping', arguments: {}}
        });

    it('serves MCP over stdio, with nothing but protocol on stdout', async () => {
        const dir = writeIndexDir({
                'react-90.0.0.json': reactIndex('90.0.0'),
                'core-44.0.0.json': coreIndex('44.0.0')
            }),
            {code, out, err} = await runCli(
                ['--index-dir', dir],
                [initialize, '{"jsonrpc":"2.0","method":"notifications/initialized"}', ping]
            );
        expect(code).toBe(0);
        expect(out.map(m => m.id)).toEqual([1, 2]);
        expect(out[0].result.instructions).toContain(
            'These are the Hoist versions this project uses.'
        );
        expect(out[1].result.content[0].text).toContain('react: @xh/hoist 90.0.0');
        expect(err).toContain('serving over stdio');
    }, 30_000);

    it("serves a project's own versions from the cache", async () => {
        const tgz = packFixtures(),
            registry = new FakeRegistry(),
            cacheDir = mkdtempSync(join(tmpdir(), 'hoist-docs-cache-')),
            resolver = new IndexResolver(registry, cacheDir);
        registry.add('@xh/hoist-react-docs-index', '90.0.0', tgz.react90);
        registry.add('@xh/hoist-core-docs-index', '44.0.0', tgz.core44);
        await resolver.resolve('react', '90.0.0');
        await resolver.resolve('core', '44.0.0');

        const root = mkdtempSync(join(tmpdir(), 'hoist-app-'));
        mkdirSync(join(root, 'client-app/node_modules/@xh/hoist'), {recursive: true});
        writeFileSync(
            join(root, 'client-app/node_modules/@xh/hoist/package.json'),
            JSON.stringify({version: '90.0.0'})
        );
        writeFileSync(join(root, 'gradle.properties'), 'hoistCoreVersion=44.0.0\n');

        const {code, out} = await runCli(['--project', root], [initialize, ping], {
            HOIST_DOCS_CACHE: cacheDir
        });
        expect(code).toBe(0);
        const text = out[1].result.content[0].text;
        expect(text).toContain('react: @xh/hoist 90.0.0 - 4 docs');
        expect(text).toContain('core: io.xh:hoist-core 44.0.0 - 2 docs');
    }, 60_000);

    it('fails clearly outside a Hoist project', async () => {
        const {code, err} = await runCli(
            ['--project', mkdtempSync(join(tmpdir(), 'not-hoist-'))],
            []
        );
        expect(code).toBe(1);
        expect(err).toContain('No Hoist versions found');
    }, 30_000);

    it('exports docs payloads for a viewer', async () => {
        const dir = writeIndexDir({
                'react-90.0.0.json': reactIndex('90.0.0'),
                'core-44.0.0.json': coreIndex('44.0.0')
            }),
            out = mkdtempSync(join(tmpdir(), 'hoist-docs-export-')),
            {code} = await runCli(['export-docs', '--index-dir', dir, '--out', out], []);
        expect(code).toBe(0);
        expect(JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'))).toEqual([
            {id: 'react', name: '@xh/hoist', version: '90.0.0', file: 'react.json'},
            {id: 'core', name: 'io.xh:hoist-core', version: '44.0.0', file: 'core.json'}
        ]);
        const react = JSON.parse(readFileSync(join(out, 'react.json'), 'utf8'));
        expect(Object.keys(react)).toEqual(['schemaVersion', 'library', 'docs']);
        expect(react.docs.entries).toHaveLength(4);
    }, 30_000);
});

describe('docs from a checkout', () => {
    function checkout(files: Record<string, string>): string {
        const dir = mkdtempSync(join(tmpdir(), 'hoist-checkout-'));
        for (const [path, text] of Object.entries(files)) {
            mkdirSync(dirname(join(dir, path)), {recursive: true});
            writeFileSync(join(dir, path), text);
        }
        return dir;
    }

    it('reads hoist-react docs with its builder rules', () => {
        const dir = checkout({
            'package.json': JSON.stringify({
                name: '@xh/hoist',
                version: '91.0.0-SNAPSHOT',
                description: 'Hoist'
            }),
            'docs/doc-registry.json': JSON.stringify({
                mcpCategories: [{id: 'package', title: 'Package Documentation'}],
                viewerCategories: [{id: 'components', title: 'Components'}],
                entries: [
                    {
                        id: 'cmp/grid/README.md',
                        title: 'Grid',
                        mcpCategory: 'package',
                        viewerCategory: 'components',
                        keywords: ['grid', 3]
                    },
                    {id: 'docs/maintaining.md', title: 'Maintaining', mcpAudience: 'maintainers'},
                    {id: 'docs/missing.md', title: 'Missing'},
                    {id: 'docs/concepts.md', mcpCategory: 'concept'}
                ]
            }),
            'cmp/grid/README.md': '# Grid\n',
            'docs/maintaining.md': '# Maintaining\n',
            'docs/concepts.md': '# Concepts\n'
        });
        const payload = docsFromCheckout(dir);
        expect(payload.library).toMatchObject({
            id: 'react',
            name: '@xh/hoist',
            version: '91.0.0-SNAPSHOT'
        });
        expect(payload.docs.entries.map(e => e.id)).toEqual([
            'cmp/grid/README.md',
            'docs/concepts.md'
        ]);
        expect(payload.docs.entries[0]).toMatchObject({
            keywords: ['grid'],
            aliases: [],
            markdown: '# Grid\n'
        });
        // Untitled entries take their id; categories used but not declared are added.
        expect(payload.docs.entries[1]).toMatchObject({
            title: 'docs/concepts.md',
            viewerCategory: null
        });
        expect(payload.docs.mcpCategories?.map(c => c.id)).toEqual(['package', 'concept']);
    });

    it('reads hoist-core docs with its builder rules', () => {
        const dir = checkout({
            'settings.gradle': "rootProject.name = 'hoist-core'\n",
            'gradle.properties': 'xhReleaseVersion=45.0-SNAPSHOT\n',
            'docs/doc-registry.json': JSON.stringify({
                entries: [
                    {
                        id: 'docs/caching.md',
                        title: 'Caching',
                        mcpCategory: 'concept',
                        viewerCategory: 'concepts'
                    },
                    {id: 'docs/missing.md', title: 'Missing'}
                ]
            }),
            'docs/caching.md': '# Caching\n'
        });
        const payload = docsFromCheckout(dir);
        expect(payload.library).toMatchObject({
            id: 'core',
            name: 'io.xh:hoist-core',
            version: '45.0-SNAPSHOT'
        });
        expect(payload.docs.entries).toEqual([
            {
                id: 'docs/caching.md',
                title: 'Caching',
                mcpCategory: 'concept',
                viewerCategory: 'concepts',
                description: '',
                keywords: [],
                aliases: [],
                markdown: '# Caching\n'
            }
        ]);
    });

    it('refuses anything else', () => {
        expect(() => docsFromCheckout(checkout({'package.json': '{"name": "other"}'}))).toThrow(
            /not a hoist-react or hoist-core checkout/
        );
    });
});
