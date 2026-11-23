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
import {fileURLToPath, pathToFileURL} from 'node:url';
import {gunzipSync, gzipSync} from 'node:zlib';

import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {describe, expect, it} from 'vitest';

import type {IndexFile} from '../src/index/types.ts';
import {IndexStore} from '../src/IndexStore.ts';
import {IndexCache} from '../src/local/cache.ts';
import {docsFromCheckout} from '../src/local/checkout.ts';
import {findInstalledIndexes} from '../src/local/installed.ts';
import {MavenSource} from '../src/local/maven.ts';
import {NpmSource} from '../src/local/npm.ts';
import {detectProjectVersions, LATEST_SNAPSHOT} from '../src/local/project.ts';
import type {Registry} from '../src/local/registry.ts';
import {BuiltInSource} from '../src/local/sources.ts';
import {coreIndex, reactIndex, writeIndexDir} from './fixtures.ts';

const ROOT = resolve(import.meta.dirname, '..');

const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

const libraryVersion = (path: string) =>
    JSON.parse(gunzipSync(readFileSync(path)).toString()).library.version;

/** A gzipped tar of `files`, under `package/`, as npm publishes a package. */
function tgz(files: Record<string, Buffer | string>): Buffer {
    const blocks: Buffer[] = [];
    for (const [name, content] of Object.entries(files)) {
        const data = Buffer.from(content),
            header = Buffer.alloc(512);
        header.write(`package/${name}`, 0, 100);
        header.write('0000644\0', 100);
        header.write('0000000\0', 108);
        header.write('0000000\0', 116);
        header.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
        header.write('00000000000\0', 136);
        header.write('        ', 148);
        header.write('0', 156);
        header.write('ustar\0' + '00', 257);
        let sum = 0;
        for (const b of header) sum += b;
        header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
        blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
    }
    blocks.push(Buffer.alloc(1024));
    return gzipSync(Buffer.concat(blocks));
}

/** A published npm package that ships `index` (or ships none). */
function npmPackage(name: string, version: string, index: IndexFile | null): Buffer {
    const pkg: any = {name, version};
    if (index) pkg.hoistDocs = {id: index.library.id, index: 'hoist-docs/index.json.gz'};
    return tgz({
        'package.json': JSON.stringify(pkg),
        ...(index ? {'hoist-docs/index.json.gz': gzipSync(JSON.stringify(index))} : {})
    });
}

/** A registry over package tarballs, recording calls. */
class FakeRegistry implements Registry {
    readonly tarballs = new Map<string, Buffer>();
    readonly tags = new Map<string, string>();
    calls: string[] = [];
    failing = false;

    add(pkg: string, version: string, tgz: Buffer): void {
        this.tarballs.set(`${pkg}@${version}`, tgz);
    }

    async distTag(pkg: string, tag: string): Promise<string | null> {
        this.call(`distTag ${pkg} ${tag}`);
        return this.tags.get(`${pkg}#${tag}`) ?? null;
    }

    async pack(pkg: string, version: string): Promise<Buffer> {
        this.call(`pack ${pkg}@${version}`);
        const ret = this.tarballs.get(`${pkg}@${version}`);
        if (!ret) throw new Error(`npm pack ${pkg}@${version} failed: E404`);
        return ret;
    }

    private call(desc: string): void {
        if (this.failing) throw new Error('offline');
        this.calls.push(desc);
    }
}

/** A Maven repository on disk, holding hoist-core `docs-index` artifacts. */
function mavenRepo(opts: {releases?: string[]; snapshots?: Record<string, string>} = {}): string {
    const repo = tmp('hoist-docs-maven-'),
        dir = join(repo, 'io/xh/hoist-core'),
        file = (v: string, build: string, index: IndexFile) => {
            mkdirSync(join(dir, v), {recursive: true});
            writeFileSync(
                join(dir, v, `hoist-core-${build}-docs-index.json.gz`),
                gzipSync(JSON.stringify(index))
            );
        };
    const releases = opts.releases ?? [],
        snapshots = opts.snapshots ?? {};
    for (const v of releases) file(v, v, coreIndex(v));
    for (const [v, build] of Object.entries(snapshots)) {
        file(v, build, coreIndex(build));
        writeFileSync(
            join(dir, v, 'maven-metadata.xml'),
            `<metadata><versioning><snapshotVersions>
               <snapshotVersion><extension>jar</extension><value>${build}</value></snapshotVersion>
               <snapshotVersion><classifier>docs-index</classifier><extension>json.gz</extension><value>${build}</value></snapshotVersion>
             </snapshotVersions></versioning></metadata>`
        );
    }
    const all = [...releases, ...Object.keys(snapshots)];
    if (all.length) {
        mkdirSync(dir, {recursive: true});
        writeFileSync(
            join(dir, 'maven-metadata.xml'),
            `<metadata><versioning>${releases.length ? `<release>${releases.at(-1)}</release>` : ''}<versions>${all.map(v => `<version>${v}</version>`).join('')}</versions></versioning></metadata>`
        );
    }
    return pathToFileURL(repo).href;
}

/** Install a package into a project's client-app, shipping `index` if given. */
function install(root: string, name: string, version: string, index?: IndexFile, decl?: any): void {
    const dir = join(root, 'client-app/node_modules', ...name.split('/'));
    mkdirSync(dir, {recursive: true});
    const pkg: any = {name, version};
    if (index) {
        pkg.hoistDocs = decl ?? {id: index.library.id, index: 'hoist-docs/index.json.gz'};
        mkdirSync(join(dir, 'hoist-docs'), {recursive: true});
        writeFileSync(join(dir, 'hoist-docs/index.json.gz'), gzipSync(JSON.stringify(index)));
    }
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
}

/** A third-party library's index, carrying agent instructions. */
function acmeIndex(id = 'acme', name = '@acme/widgets'): IndexFile {
    const ret = reactIndex('1.0.0');
    ret.library = {...ret.library, id, name, instructions: 'Always use AcmeGrid.'};
    return ret;
}

/** Publish a Grails library's `docs-index` artifact into a `file:` repository. */
function publishIndex(repo: string, coords: string, index: IndexFile): void {
    const [group, artifact, version] = coords.split(':'),
        dir = join(fileURLToPath(repo), ...group.split('.'), artifact, version);
    mkdirSync(dir, {recursive: true});
    writeFileSync(
        join(dir, `${artifact}-${version}-docs-index.json.gz`),
        gzipSync(JSON.stringify(index))
    );
}

/** An organization's Grails plugin index, carrying agent instructions. */
function pluginIndex(version: string, id = 'acme', name = 'com.acme:acme-hoist'): IndexFile {
    const ret = coreIndex(version);
    ret.library = {...ret.library, id, name, instructions: 'Prefer AcmeBaseService.'};
    return ret;
}

/** A Grails app's build files. */
function grailsApp(files: Record<string, string>): string {
    const root = tmp('hoist-app-');
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
    return root;
}

describe('project versions', () => {
    it('reads the installed @xh/hoist and hoistCoreVersion', () => {
        const root = tmp('hoist-app-');
        install(root, '@xh/hoist', '90.1.2');
        writeFileSync(
            join(root, 'client-app/package.json'),
            JSON.stringify({dependencies: {'@xh/hoist': '^90.0.0'}})
        );
        writeFileSync(join(root, 'gradle.properties'), 'xhAppCode=app\nhoistCoreVersion=44.0.0\n');
        expect(detectProjectVersions(root)).toEqual({
            versions: {react: '90.1.2', core: '44.0.0'},
            notes: [],
            missing: [],
            gradleLibraries: []
        });
    });

    it('prefers the hoist-core version in gradle.lockfile, the one the app runs with', () => {
        const root = grailsApp({
            'gradle.properties': 'hoistCoreVersion=44.0.0\n',
            'gradle.lockfile': [
                '# This is a Gradle generated file for dependency locking.',
                'io.xh:hoist-core-test:44.1.0=testCompileClasspath,testRuntimeClasspath',
                'io.xh:hoist-core:44.0.1=grailsCliDetect',
                'io.xh:hoist-core:44.1.0=compileClasspath,runtimeClasspath,testRuntimeClasspath',
                'empty=annotationProcessor'
            ].join('\n')
        });
        const v = detectProjectVersions(root);
        expect(v.versions).toEqual({core: '44.1.0'});
        expect(v.notes[0]).toContain(
            'gradle.lockfile locks io.xh:hoist-core 44.1.0, but gradle.properties sets hoistCoreVersion=44.0.0'
        );
    });

    it('reads hoist-core from gradle.lockfile when it comes through another plugin', () => {
        const root = grailsApp({
            'gradle.properties': 'acmeHoistVersion=3.2.0\n',
            'build.gradle':
                'dependencies {\n    implementation "com.acme:acme-hoist:$acmeHoistVersion"\n}\n',
            'gradle.lockfile': [
                'com.acme:acme-hoist:3.2.0=compileClasspath,runtimeClasspath',
                'io.xh:hoist-core:44.1.0=compileClasspath,runtimeClasspath'
            ].join('\n')
        });
        expect(detectProjectVersions(root)).toEqual({
            versions: {core: '44.1.0'},
            notes: [],
            missing: [],
            gradleLibraries: []
        });
    });

    it("explains a Grails app's missing hoist-core version", () => {
        const root = grailsApp({
            'build.gradle': 'dependencies {\n    implementation "com.acme:acme-hoist:3.2.0"\n}\n'
        });
        const v = detectProjectVersions(root);
        expect(v.versions).toEqual({});
        expect(v.missing).toEqual([
            {
                libraryId: 'core',
                reason: expect.stringContaining('Turn on dependency locking in build.gradle')
            }
        ]);
    });

    it('reads the Grails libraries in hoistDocsLibraries, at their locked versions', () => {
        const root = grailsApp({
            'gradle.properties':
                'hoistDocsLibraries=com.acme:acme-hoist, com.acme:acme-base,com.acme:unlocked,bad,io.xh:hoist-core\n',
            'gradle.lockfile': [
                'com.acme:acme-base:1.0.0=compileClasspath,runtimeClasspath',
                'com.acme:acme-hoist:3.2.0=compileClasspath,runtimeClasspath',
                'io.xh:hoist-core:44.1.0=compileClasspath,runtimeClasspath'
            ].join('\n')
        });
        const v = detectProjectVersions(root);
        expect(v.gradleLibraries).toEqual([
            {group: 'com.acme', artifact: 'acme-hoist', version: '3.2.0'},
            {group: 'com.acme', artifact: 'acme-base', version: '1.0.0'}
        ]);
        expect(v.notes).toEqual([
            expect.stringContaining(
                'hoistDocsLibraries in gradle.properties lists com.acme:unlocked, but gradle.lockfile does not lock it. Skipped. Run ./gradlew dependencies --write-locks, then restart.'
            ),
            expect.stringContaining("hoistDocsLibraries in gradle.properties lists 'bad'"),
            expect.stringContaining(
                'hoistDocsLibraries in gradle.properties lists io.xh:hoist-core, which is found without it'
            )
        ]);
    });

    it('reads an installed hoist-chat-kit', () => {
        const root = tmp('hoist-app-');
        install(root, '@xh/hoist', '90.1.2');
        install(root, '@xh/hoist-chat-kit', '1.2.0');
        expect(detectProjectVersions(root).versions).toEqual({
            react: '90.1.2',
            'chat-kit': '1.2.0'
        });
    });

    it('notes a dependency that is not installed', () => {
        const root = tmp('hoist-app-');
        mkdirSync(join(root, 'client-app'));
        writeFileSync(
            join(root, 'client-app/package.json'),
            JSON.stringify({dependencies: {'@xh/hoist': '^90.0.0'}})
        );
        const v = detectProjectVersions(root);
        expect(v.versions.react).toBeUndefined();
        expect(v.notes[0]).toContain('not installed');
    });

    it('serves a hoist-react checkout the newest snapshots', () => {
        const root = tmp('hoist-react-');
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify({name: '@xh/hoist', version: '91.0.0-SNAPSHOT'})
        );
        expect(detectProjectVersions(root)).toEqual({
            versions: {react: LATEST_SNAPSHOT, core: LATEST_SNAPSHOT},
            notes: [],
            missing: [],
            gradleLibraries: [],
            checkout: 'react'
        });
    });

    it('serves a hoist-core checkout its own snapshot line', () => {
        const root = tmp('hoist-core-');
        writeFileSync(join(root, 'settings.gradle'), "rootProject.name = 'hoist-core'\n");
        writeFileSync(join(root, 'gradle.properties'), 'xhReleaseVersion=45.0-SNAPSHOT\n');
        expect(detectProjectVersions(root)).toEqual({
            versions: {react: LATEST_SNAPSHOT, core: '45.0-SNAPSHOT'},
            notes: [],
            missing: [],
            gradleLibraries: [],
            checkout: 'core'
        });
    });

    it('serves a hoist-core checkout with no release version its newest snapshot', () => {
        const root = tmp('hoist-core-');
        writeFileSync(join(root, 'settings.gradle'), "rootProject.name = 'hoist-core'\n");
        writeFileSync(join(root, 'gradle.properties'), 'xhReleaseVersion=\nxhAppCode=core\n');
        expect(detectProjectVersions(root).versions.core).toBe(LATEST_SNAPSHOT);
    });

    it('recognizes a hoist-chat-kit checkout, with the @xh/hoist it installs', () => {
        const root = tmp('hoist-chat-kit-');
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify({name: '@xh/hoist-chat-kit', version: '2.0.0-SNAPSHOT'})
        );
        mkdirSync(join(root, 'node_modules/@xh/hoist'), {recursive: true});
        writeFileSync(
            join(root, 'node_modules/@xh/hoist/package.json'),
            JSON.stringify({version: '90.0.0'})
        );
        expect(detectProjectVersions(root)).toEqual({
            versions: {react: '90.0.0', core: LATEST_SNAPSHOT, 'chat-kit': LATEST_SNAPSHOT},
            notes: [],
            missing: [],
            gradleLibraries: [],
            checkout: 'chat-kit'
        });
    });
});

describe('installed indexes', () => {
    it('finds every installed package that ships one, any scope', () => {
        const root = tmp('hoist-app-');
        install(root, '@xh/hoist', '91.0.0-SNAPSHOT.1794261201542', reactIndex('91.0.0'));
        install(root, '@acme/widgets', '1.0.0', acmeIndex());
        install(root, 'lodash', '4.17.21');
        const {indexes, notes} = findInstalledIndexes(root);
        expect(notes).toEqual([]);
        expect(indexes.map(i => [i.libraryId, i.version, i.packageName, i.trusted])).toEqual([
            ['acme', '1.0.0', '@acme/widgets', false],
            ['react', '91.0.0-SNAPSHOT.1794261201542', '@xh/hoist', true]
        ]);
    });

    it('keeps the @xh package when two claim the same id, and notes problems', () => {
        const root = tmp('hoist-app-');
        install(root, '@acme/fake-hoist', '1.0.0', acmeIndex('react'));
        install(root, '@xh/hoist', '91.0.0', reactIndex('91.0.0'));
        install(root, '@acme/broken', '1.0.0', acmeIndex('broken'), {
            id: 'broken',
            index: 'nope.json.gz'
        });
        install(root, '@acme/sneaky', '1.0.0', acmeIndex('sneaky'), {
            id: 'sneaky',
            index: '../hoist/hoist-docs/index.json.gz'
        });
        const {indexes, notes} = findInstalledIndexes(root);
        expect(indexes.map(i => i.packageName)).toEqual(['@xh/hoist']);
        expect(notes).toHaveLength(3);
        expect(notes.join('\n')).toContain('outside its package');
        expect(notes.join('\n')).toContain("serving @xh/hoist's");
        expect(notes.join('\n')).toContain('but it is missing');
    });

    it('drops agent instructions from outside the @xh scope', () => {
        const root = tmp('hoist-app-');
        install(root, '@acme/widgets', '1.0.0', acmeIndex());
        install(root, '@xh/hoist-chat-kit', '2.0.0', acmeIndex('chat-kit', '@xh/hoist-chat-kit'));
        const store = new IndexStore(
            findInstalledIndexes(root).indexes.map(i => ({...i, path: i.path}))
        );
        expect(store.get('acme').instructions).toBeNull();
        expect(store.get('chat-kit').instructions).toBe('Always use AcmeGrid.');
    });
});

describe('Maven source', () => {
    const source = (repo: string, now = () => 1_000_000) =>
        new MavenSource({
            releaseRepo: repo,
            snapshotRepo: repo,
            cache: new IndexCache(tmp('hoist-docs-cache-')),
            now
        });

    it('fetches a release once, then serves it from the cache', async () => {
        const repo = mavenRepo({releases: ['44.0.0']}),
            maven = source(repo),
            path = await maven.resolve('io.xh', 'hoist-core', '44.0.0');
        expect(path).toMatch(/hoist-core-44\.0\.0-docs-index\.json\.gz$/);
        expect(libraryVersion(path)).toBe('44.0.0');
        expect(await maven.latestRelease('io.xh', 'hoist-core')).toBe('44.0.0');
    });

    it("resolves a snapshot to its newest timestamped build, and a local repo's plain one", async () => {
        const remote = mavenRepo({snapshots: {'45.0-SNAPSHOT': '45.0-20261110.120000-3'}}),
            path = await source(remote).resolve('io.xh', 'hoist-core', '45.0-SNAPSHOT');
        expect(libraryVersion(path)).toBe('45.0-20261110.120000-3');
        expect(await source(remote).latestSnapshot('io.xh', 'hoist-core')).toBe('45.0-SNAPSHOT');

        // ~/.m2 holds `hoist-core-45.0-SNAPSHOT-docs-index.json.gz` and no maven-metadata.xml.
        const local = mavenRepo({releases: ['45.0-SNAPSHOT']});
        expect(
            libraryVersion(await source(local).resolve('io.xh', 'hoist-core', '45.0-SNAPSHOT'))
        ).toBe('45.0-SNAPSHOT');
    });

    it('rechecks a snapshot daily, and falls back to the cache when unreachable', async () => {
        let now = 1_000_000,
            failing = false;
        const repoUrl = mavenRepo({snapshots: {'45.0-SNAPSHOT': '45.0-20261110.120000-3'}}),
            fetched: string[] = [],
            maven = new MavenSource({
                releaseRepo: repoUrl,
                snapshotRepo: repoUrl,
                cache: new IndexCache(tmp('hoist-docs-cache-')),
                now: () => now,
                fetcher: async url => {
                    if (failing) throw new Error('offline');
                    fetched.push(url.slice(url.lastIndexOf('/') + 1));
                    try {
                        return readFileSync(new URL(url));
                    } catch {
                        return null;
                    }
                }
            });
        const first = await maven.resolve('io.xh', 'hoist-core', '45.0-SNAPSHOT');
        fetched.length = 0;
        expect(await maven.resolve('io.xh', 'hoist-core', '45.0-SNAPSHOT')).toBe(first);
        expect(fetched).toEqual([]);

        now += 25 * 3600_000;
        failing = true;
        expect(await maven.resolve('io.xh', 'hoist-core', '45.0-SNAPSHOT')).toBe(first);
    });

    it('explains a release that ships no index', async () => {
        await expect(source(mavenRepo()).resolve('io.xh', 'hoist-core', '30.0.0')).rejects.toThrow(
            /hoist-core 30\.0\.0 has no docs-index artifact/
        );
    });
});

describe('npm source', () => {
    const setup = () => {
        const registry = new FakeRegistry();
        registry.add('@xh/hoist', '90.0.0', npmPackage('@xh/hoist', '90.0.0', null));
        registry.add(
            '@xh/hoist',
            '91.0.0',
            npmPackage('@xh/hoist', '91.0.0', reactIndex('91.0.0'))
        );
        registry.add(
            '@xh/hoist',
            '92.0.0-SNAPSHOT.1',
            npmPackage('@xh/hoist', '92.0.0-SNAPSHOT.1', reactIndex('92.0.0-SNAPSHOT.1'))
        );
        registry.tags.set('@xh/hoist#latest', '91.0.0');
        registry.tags.set('@xh/hoist#next', '92.0.0-SNAPSHOT.1');
        let now = 1_000_000;
        const npm = new NpmSource(registry, new IndexCache(tmp('hoist-docs-cache-')), () => now);
        return {registry, npm, advance: (ms: number) => (now += ms)};
    };

    it('pulls the index out of a package version, once', async () => {
        const {registry, npm} = setup(),
            path = await npm.resolve('@xh/hoist', '91.0.0');
        expect(libraryVersion(path)).toBe('91.0.0');
        registry.calls = [];
        expect(await npm.resolve('@xh/hoist', '91.0.0')).toBe(path);
        expect(registry.calls).toEqual([]);
        await expect(npm.resolve('@xh/hoist', '90.0.0')).rejects.toThrow(
            '@xh/hoist@90.0.0 ships no Hoist Docs index'
        );
    });

    it('follows a dist-tag, rechecked daily, falling back to the cache offline', async () => {
        const {registry, npm, advance} = setup();
        expect((await npm.resolveTag('@xh/hoist', 'next')).version).toBe('92.0.0-SNAPSHOT.1');

        registry.calls = [];
        await npm.resolveTag('@xh/hoist', 'next');
        expect(registry.calls).toEqual([]);

        advance(25 * 3600_000);
        registry.failing = true;
        expect((await npm.resolveTag('@xh/hoist', 'next')).version).toBe('92.0.0-SNAPSHOT.1');
    });
});

describe('on-demand index store', () => {
    const setup = () => {
        const registry = new FakeRegistry(),
            cache = new IndexCache(tmp('hoist-docs-cache-')),
            repo = mavenRepo({releases: ['44.0.0']});
        registry.add(
            '@xh/hoist',
            '91.0.0',
            npmPackage('@xh/hoist', '91.0.0', reactIndex('91.0.0'))
        );
        registry.add('@xh/hoist', '90.0.0', npmPackage('@xh/hoist', '90.0.0', null));
        registry.tags.set('@xh/hoist#latest', '91.0.0');
        const store = new IndexStore({
            source: new BuiltInSource(
                new NpmSource(registry, cache),
                new MavenSource({releaseRepo: repo, snapshotRepo: repo, cache})
            )
        });
        return {registry, store};
    };

    it('fetches the newest release of each library, skipping one with nothing published', async () => {
        const {registry, store} = setup();
        await store.ensure();
        expect(store.onDemand).toBe(true);
        expect(store.libraryIds()).toEqual(['react', 'core']);
        expect(store.versions('react')).toEqual(['91.0.0']);
        expect(store.versions('core')).toEqual(['44.0.0']);
        expect(store.get('react').docs.length).toBeGreaterThan(0);

        // Within the recheck interval, nothing is asked of the registry again - not even for the
        // library that failed.
        registry.calls = [];
        await store.ensure();
        expect(registry.calls).toEqual([]);
    });

    it('asks the registry for the newest release again on each fetch, not daily', async () => {
        const {registry} = setup(),
            cache = new IndexCache(tmp('hoist-docs-cache-')),
            source = new BuiltInSource(new NpmSource(registry, cache), new MavenSource({cache}));
        expect(await source.latestRelease('react')).toBe('91.0.0');
        registry.add(
            '@xh/hoist',
            '92.0.0',
            npmPackage('@xh/hoist', '92.0.0', reactIndex('92.0.0'))
        );
        registry.tags.set('@xh/hoist#latest', '92.0.0');
        expect(await source.latestRelease('react')).toBe('92.0.0');
    });

    it('fetches a named version, and fails clearly for one that ships no index', async () => {
        const {store} = setup();
        await store.ensure('core', '44.0.0');
        expect(store.versions('core')).toEqual(['44.0.0']);
        await expect(store.ensure('react', '90.0.0')).rejects.toThrow(
            '@xh/hoist@90.0.0 ships no Hoist Docs index'
        );
        await expect(store.ensure('chat-kit')).rejects.toThrow(
            "@xh/hoist-chat-kit has no 'latest' dist-tag"
        );
        await expect(store.ensure('nope')).rejects.toThrow("Unknown library 'nope'");
    });

    it('refuses a version that is not a plain version, before it reaches npm or Maven', async () => {
        const {registry, store} = setup();
        registry.calls = [];
        for (const version of [
            'github:attacker/repo',
            'https://evil.example/x.tgz',
            'npm:other-package@1.0.0',
            '../../../../etc/x',
            'latest',
            '91.0.0 && id'
        ]) {
            await expect(store.ensure('react', version)).rejects.toThrow('is not a version');
            await expect(store.ensure('core', version)).rejects.toThrow('is not a version');
        }
        expect(registry.calls).toEqual([]);
    });
});

describe('hoist-docs command', () => {
    /** Run the CLI from source, feeding it stdin lines; resolves with stdout lines. */
    function runCli(args: string[], input: string[], env: Record<string, string> = {}) {
        return new Promise<{code: number | null; out: any[]; err: string}>(done => {
            const child = spawn(process.execPath, [join(ROOT, 'src/cli.ts'), ...args], {
                // No inherited INDEX_DIR, which would bypass the project's versions.
                env: {...process.env, INDEX_DIR: '', ...env}
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
            params: {
                protocolVersion: '2025-06-18',
                capabilities: {},
                clientInfo: {name: 'spec', version: '1.0.0'}
            }
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
        const byId = new Map(out.map(m => [m.id, m]));
        expect([...byId.keys()].sort()).toEqual([1, 2]);
        expect(byId.get(1).result.instructions).toContain(
            'These are the Hoist versions this project uses.'
        );
        expect(byId.get(2).result.content[0].text).toContain('react: @xh/hoist 90.0.0');
        expect(err).toContain('serving over stdio');
    }, 30_000);

    it('serves the 2026-07-28 protocol over stdio, to the official client', async () => {
        const dir = writeIndexDir({'react-90.0.0.json': reactIndex('90.0.0')}),
            client = new Client({name: 'spec', version: '1.0.0'}, {
                versionNegotiation: {mode: 'auto'}
            } as ConstructorParameters<typeof Client>[1]);
        await client.connect(
            new StdioClientTransport({
                command: process.execPath,
                args: [join(ROOT, 'src/cli.ts'), '--index-dir', dir],
                stderr: 'ignore'
            })
        );
        try {
            expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
            const res = await client.callTool({name: 'hoist-read-doc', arguments: {id: 'grid'}});
            expect((res.content[0] as any).text).toContain('# Grid Package');
        } finally {
            await client.close();
        }
    }, 30_000);

    it("serves a project's installed indexes, and hoist-core's from Maven", async () => {
        const root = tmp('hoist-app-');
        install(root, '@xh/hoist', '91.0.0', reactIndex('91.0.0'));
        install(root, '@acme/widgets', '1.0.0', acmeIndex());
        writeFileSync(join(root, 'gradle.properties'), 'hoistCoreVersion=45.0-SNAPSHOT\n');

        const repo = mavenRepo({snapshots: {'45.0-SNAPSHOT': '45.0-20261110.120000-3'}}),
            {code, out} = await runCli(['--project', root], [initialize, ping], {
                HOIST_DOCS_CACHE: tmp('hoist-docs-cache-'),
                HOIST_DOCS_MAVEN_SNAPSHOT_REPO: repo
            });
        expect(code).toBe(0);
        const text = out.find(m => m.id === 2).result.content[0].text;
        expect(text).toContain('react: @xh/hoist 91.0.0 - 4 docs');
        expect(text).toContain('core: io.xh:hoist-core 45.0-20261110.120000-3');
        expect(text).toContain('acme: @acme/widgets 1.0.0');
        expect(out.find(m => m.id === 1).result.instructions).not.toContain('AcmeGrid');
    }, 60_000);

    it('serves the hoist-core version an app gets through its own plugin, from its lockfile', async () => {
        const root = grailsApp({
            'build.gradle': 'dependencies {\n    implementation "com.acme:acme-hoist:3.2.0"\n}\n',
            'gradle.lockfile': 'io.xh:hoist-core:44.0.0=compileClasspath,runtimeClasspath\n'
        });
        install(root, '@xh/hoist', '91.0.0', reactIndex('91.0.0'));

        const {code, out} = await runCli(['--project', root], [initialize, ping], {
            HOIST_DOCS_CACHE: tmp('hoist-docs-cache-'),
            HOIST_DOCS_MAVEN_REPO: mavenRepo({releases: ['44.0.0']})
        });
        expect(code).toBe(0);
        const text = out.find(m => m.id === 2).result.content[0].text;
        expect(text).toContain('core: io.xh:hoist-core 44.0.0');
    }, 60_000);

    it("tells the agent when hoist-core's version cannot be found", async () => {
        const root = grailsApp({
            'build.gradle': 'dependencies {\n    implementation "com.acme:acme-hoist:3.2.0"\n}\n'
        });
        install(root, '@xh/hoist', '91.0.0', reactIndex('91.0.0'));

        const {code, out} = await runCli(['--project', root], [initialize, ping], {
            HOIST_DOCS_CACHE: tmp('hoist-docs-cache-'),
            HOIST_DOCS_MAVEN_REPO: mavenRepo()
        });
        expect(code).toBe(0);
        const text = out.find(m => m.id === 2).result.content[0].text;
        expect(text).toContain('react: @xh/hoist 91.0.0');
        expect(text).toContain('Not loaded:\n- core: No io.xh:hoist-core version found');
        expect(text).toContain(
            'Turn on dependency locking in build.gradle (dependencyLocking { lockAllConfigurations() }), run ./gradlew dependencies --write-locks'
        );
        expect(out.find(m => m.id === 1).result.instructions).toContain(
            "Not loaded: core (hoist-ping says why). For those, read the library's own docs and source for the version the project uses instead."
        );
    }, 60_000);

    it("serves the Grails libraries an app lists, beside hoist-core's", async () => {
        const root = grailsApp({
            'gradle.properties': 'hoistDocsLibraries=com.acme:acme-hoist\n',
            'gradle.lockfile': [
                'com.acme:acme-base:1.0.0=compileClasspath,runtimeClasspath',
                'com.acme:acme-hoist:3.2.0=compileClasspath,runtimeClasspath',
                'io.xh:hoist-core:44.0.0=compileClasspath,runtimeClasspath'
            ].join('\n')
        });
        install(root, '@xh/hoist', '91.0.0', reactIndex('91.0.0'));
        const repo = mavenRepo({releases: ['44.0.0']});
        publishIndex(repo, 'com.acme:acme-hoist:3.2.0', pluginIndex('3.2.0'));
        // Ships an index, but the app does not list it.
        publishIndex(
            repo,
            'com.acme:acme-base:1.0.0',
            pluginIndex('1.0.0', 'acmebase', 'com.acme:acme-base')
        );

        const {code, out} = await runCli(['--project', root], [initialize, ping], {
            HOIST_DOCS_CACHE: tmp('hoist-docs-cache-'),
            HOIST_DOCS_MAVEN_REPO: repo
        });
        expect(code).toBe(0);
        const text = out.find(m => m.id === 2).result.content[0].text,
            instructions = out.find(m => m.id === 1).result.instructions;
        expect(text).toContain('core: io.xh:hoist-core 44.0.0');
        expect(text).toContain('acme: com.acme:acme-hoist 3.2.0');
        expect(text).not.toContain('acmebase');
        expect(instructions).toContain(
            'server Groovy or Java (grails-app/, src/main/) is core (io.xh:hoist-core) or acme (com.acme:acme-hoist).'
        );
        // The app chose it, so its agent instructions reach the agent.
        expect(instructions).toContain(
            'com.acme:acme-hoist (com.acme:acme-hoist): Prefer AcmeBaseService.'
        );
    }, 60_000);

    it('skips a listed Grails library whose index is missing, unreadable or misnamed', async () => {
        const root = grailsApp({
            'gradle.properties':
                'hoistDocsLibraries=com.acme:acme-hoist,com.acme:acme-fake,com.acme:acme-future\n',
            'gradle.lockfile': [
                'com.acme:acme-fake:1.0.0=runtimeClasspath',
                'com.acme:acme-future:1.0.0=runtimeClasspath',
                'com.acme:acme-hoist:3.2.0=runtimeClasspath',
                'io.xh:hoist-core:44.0.0=runtimeClasspath'
            ].join('\n')
        });
        install(root, '@xh/hoist', '91.0.0', reactIndex('91.0.0'));
        const repo = mavenRepo({releases: ['44.0.0']});
        // Built without --library, so the index calls itself core.
        publishIndex(repo, 'com.acme:acme-fake:1.0.0', pluginIndex('1.0.0', 'core'));
        // Built by a newer builder, in a schema this tool cannot read.
        const future = pluginIndex('1.0.0', 'future');
        future.schemaVersion = 99;
        publishIndex(repo, 'com.acme:acme-future:1.0.0', future);

        const {code, out, err} = await runCli(['--project', root], [initialize, ping], {
            HOIST_DOCS_CACHE: tmp('hoist-docs-cache-'),
            HOIST_DOCS_MAVEN_REPO: repo
        });
        expect(code).toBe(0);
        expect(err).toContain(
            'hoistDocsLibraries lists com.acme:acme-hoist:3.2.0, but it was not loaded: com.acme:acme-hoist 3.2.0 has no docs-index artifact'
        );
        expect(err).toContain("its index has id 'core', which another library already uses");
        expect(err).toContain('Unsupported index schemaVersion 99');
        const text = out.find(m => m.id === 2).result.content[0].text;
        expect(text).toContain('core: io.xh:hoist-core 44.0.0');
        expect(text.match(/- core:/g)).toHaveLength(1);
        expect(text).toContain('Not loaded:\n- acme-hoist 3.2.0: hoistDocsLibraries lists');
        expect(text).toContain('- acme-fake 1.0.0:');
        expect(text).toContain('- acme-future 1.0.0:');
        expect(out.find(m => m.id === 1).result.instructions).toContain(
            'server Groovy or Java (grails-app/, src/main/) is core. Some names'
        );
    }, 60_000);

    it("exports docs when a listed Grails library's index is missing", async () => {
        const root = grailsApp({
            'gradle.properties': 'hoistDocsLibraries=com.acme:acme-hoist\n',
            'gradle.lockfile': [
                'com.acme:acme-hoist:3.2.0=runtimeClasspath',
                'io.xh:hoist-core:44.0.0=runtimeClasspath'
            ].join('\n')
        });
        install(root, '@xh/hoist', '91.0.0', reactIndex('91.0.0'));
        const out = tmp('hoist-docs-export-'),
            {code, err} = await runCli(['export-docs', '--project', root, '--out', out], [], {
                HOIST_DOCS_CACHE: tmp('hoist-docs-cache-'),
                HOIST_DOCS_MAVEN_REPO: mavenRepo({releases: ['44.0.0']})
            });
        expect(code).toBe(0);
        expect(err).toContain('has no docs-index artifact');
        expect(
            JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')).map((l: any) => l.id)
        ).toEqual(['react', 'core']);
    }, 60_000);

    it('trusts a package by the folder it is installed in, not the name it gives itself', () => {
        const root = tmp('hoist-app-'),
            // Install a package in a folder, with the name it gives itself in its manifest.
            place = (folder: string, name: string, id: string) => {
                install(root, folder, '1.0.0', acmeIndex(id, name));
                writeFileSync(
                    join(root, `client-app/node_modules/${folder}/package.json`),
                    JSON.stringify({
                        name,
                        version: '1.0.0',
                        hoistDocs: {id, index: 'hoist-docs/index.json.gz'}
                    })
                );
            };
        // A direct dependency installed under an alias.
        place('ui', 'some-lib', 'ui');
        // Packages several layers down that name themselves after a direct dependency, or into
        // the @xh scope.
        place('impostor', '@acme/widgets', 'fake');
        place('xh-impostor', '@xh/fake', 'xhfake');
        writeFileSync(
            join(root, 'client-app/package.json'),
            JSON.stringify({dependencies: {ui: 'npm:some-lib@1', '@acme/widgets': '^1.0.0'}})
        );
        const trusted = Object.fromEntries(
            findInstalledIndexes(root).indexes.map(i => [i.libraryId, i.trusted])
        );
        expect(trusted).toEqual({ui: true, fake: false, xhfake: false});
    });

    it('keeps the agent instructions of an npm library the app depends on directly', async () => {
        const root = tmp('hoist-app-');
        install(root, '@xh/hoist', '91.0.0', reactIndex('91.0.0'));
        install(root, '@acme/widgets', '1.0.0', acmeIndex());
        install(root, '@other/deep', '1.0.0', acmeIndex('deep', '@other/deep'));
        writeFileSync(
            join(root, 'client-app/package.json'),
            JSON.stringify({
                dependencies: {'@xh/hoist': '^91.0.0', '@acme/widgets': '^1.0.0'}
            })
        );
        const dir = mkdtempSync(join(tmpdir(), 'hoist-docs-cache-')),
            {code, out} = await runCli(['--project', root, '--index-dir', ''], [initialize, ping], {
                HOIST_DOCS_CACHE: dir
            });
        expect(code).toBe(0);
        const instructions = out.find(m => m.id === 1).result.instructions;
        expect(instructions).toContain('@acme/widgets (@acme/widgets): Always use AcmeGrid.');
        expect(instructions).not.toContain('@other/deep (@other/deep)');
    }, 60_000);

    it('serves hoist-react when hoist-core ships no index, and tells the agent', async () => {
        const root = tmp('hoist-app-');
        install(root, '@xh/hoist', '91.0.0', reactIndex('91.0.0'));
        writeFileSync(join(root, 'gradle.properties'), 'hoistCoreVersion=44.0.0\n');

        const {code, out, err} = await runCli(['--project', root], [initialize, ping], {
            HOIST_DOCS_CACHE: tmp('hoist-docs-cache-'),
            HOIST_DOCS_MAVEN_REPO: mavenRepo()
        });
        expect(code).toBe(0);
        expect(err).toContain('Skipping core 44.0.0');
        const text = out.find(m => m.id === 2).result.content[0].text;
        expect(text).toContain('react: @xh/hoist 91.0.0');
        expect(text).toContain(
            'Not loaded:\n- core 44.0.0: io.xh:hoist-core 44.0.0 has no docs-index artifact'
        );
        expect(out.find(m => m.id === 1).result.instructions).toContain(
            'Not loaded: core 44.0.0 (hoist-ping says why).'
        );
    }, 30_000);

    it('fails clearly for an installed release that ships no index', async () => {
        const root = tmp('hoist-app-');
        install(root, '@xh/hoist', '90.0.0');
        const {code, err} = await runCli(['--project', root], [], {
            HOIST_DOCS_CACHE: tmp('hoist-docs-cache-')
        });
        expect(code).toBe(1);
        expect(err).toContain('@xh/hoist 90.0.0 is installed but ships no Hoist Docs index');
    }, 30_000);

    it('serves an INDEX_DIR given in the environment instead of resolving the project', async () => {
        const dir = writeIndexDir({'core-44.0.0.json': coreIndex('44.0.0')}),
            {code, out} = await runCli([], [initialize, ping], {INDEX_DIR: dir});
        expect(code).toBe(0);
        expect(out.find(m => m.id === 2).result.content[0].text).toContain(
            'core: io.xh:hoist-core 44.0.0'
        );
    }, 30_000);

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

    it("exports checkouts plus the project's other installed libraries", async () => {
        const reactCheckout = mkdtempSync(join(tmpdir(), 'hoist-react-'));
        mkdirSync(join(reactCheckout, 'docs'));
        writeFileSync(
            join(reactCheckout, 'package.json'),
            JSON.stringify({name: '@xh/hoist', version: '91.0.0-SNAPSHOT'})
        );
        writeFileSync(
            join(reactCheckout, 'docs/doc-registry.json'),
            JSON.stringify({entries: [{id: 'docs/README.md', title: 'Index'}]})
        );
        writeFileSync(join(reactCheckout, 'docs/README.md'), '# Index\n');

        // The project's @xh/hoist ships no index - the checkout stands in for it - and its
        // hoist-chat-kit does.
        const root = tmp('hoist-app-');
        install(root, '@xh/hoist', '90.0.0');
        install(root, '@xh/hoist-chat-kit', '2.0.0', acmeIndex('chat-kit', '@xh/hoist-chat-kit'));

        const out = tmp('hoist-docs-export-'),
            {code} = await runCli(
                ['export-docs', '--out', out, '--from-checkout', reactCheckout, '--project', root],
                [],
                {HOIST_DOCS_CACHE: tmp('hoist-docs-cache-')}
            );
        expect(code).toBe(0);
        expect(
            JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')).map((l: any) => [
                l.id,
                l.version
            ])
        ).toEqual([
            ['react', '91.0.0-SNAPSHOT'],
            ['chat-kit', '1.0.0']
        ]);
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
            /is not a checkout of hoist-react, hoist-core, hoist-chat-kit/
        );
    });
});
