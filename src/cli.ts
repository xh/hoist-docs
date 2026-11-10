/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * The `hoist-docs` command.
 *
 *   hoist-docs                     MCP over stdio, for the project in the current directory: serves
 *                                  its installed Hoist versions, fetching their indexes via npm.
 *   hoist-docs --http              MCP over HTTP, from an index directory. For
 *                                  MCP gateways and development.
 *   hoist-docs export-docs --out <dir> [--from-checkout <dir> ...]
 *                                  Write the docs part of the project's indexes, for a docs viewer
 *                                  such as Toolbox's (see `@xh/hoist-docs/docs`). With
 *                                  --from-checkout, read docs straight from hoist-react and
 *                                  hoist-core checkouts instead, in a second or two.
 *
 * Options: --project <dir> (default: current directory), --index-dir <dir> (serve or export the
 * indexes in a directory instead of resolving the project's), --port <n> (HTTP), --help.
 * Environment: see the Configuration table in docs/design.md.
 */
import {mkdirSync, readFileSync, watch, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

import {serveStdio} from '@modelcontextprotocol/server/stdio';

import {loadConfig} from './config.ts';
import {extractDocs, type DocsPayload} from './docs/index.ts';
import {IndexStore, type IndexFileSpec} from './IndexStore.ts';
import {LibraryIndex} from './index/LibraryIndex.ts';
import {docsFromCheckout} from './local/checkout.ts';
import {IndexResolver} from './local/IndexResolver.ts';
import {detectProjectVersions} from './local/project.ts';
import {NpmRegistry, type Registry} from './local/registry.ts';
import {errorData, log, logToStderr} from './log.ts';
import {createMcpServer} from './mcp.ts';
import {createApp} from './server.ts';

const USAGE = `Usage:
  hoist-docs [--project <dir>] [--index-dir <dir>]
      MCP over stdio for the project's installed Hoist versions (the default; for agents).
  hoist-docs --http [--index-dir <dir>] [--port <n>]
      MCP over HTTP, for MCP gateways and development.
  hoist-docs export-docs --out <dir> [--project <dir>] [--index-dir <dir>]
      Write docs payloads for a docs viewer, from the project's own Hoist versions.
  hoist-docs export-docs --out <dir> --from-checkout <dir> [--from-checkout <dir>] [--watch]
      Write docs payloads straight from hoist-react and hoist-core checkouts; with --watch, again
      on every doc change, for live preview.`;

export interface CliDeps {
    registry?: Registry;
    cacheDir?: string;
}

/** Run the command. Exported for tests; `bin/hoist-docs.mjs` and `pnpm start` call it. */
export async function main(argv: string[], deps: CliDeps = {}): Promise<void> {
    const args = parseArgs(argv),
        config = loadConfig(process.env, packageVersion());

    if (args.flags.has('help')) {
        process.stderr.write(USAGE + '\n');
        return;
    }
    if (args.command === 'export-docs') {
        logToStderr();
        await exportDocs(args, deps);
        return;
    }
    if (args.flags.has('http')) {
        if (args.values.port) config.port = parseInt(args.values.port);
        const store = new IndexStore(args.values['index-dir'] ?? config.indexDir);
        store.init();
        createApp(config, store).listen(config.port, () => {
            log.info('Hoist Docs started', {
                port: config.port,
                indexDir: store.dir,
                version: config.version
            });
        });
        return;
    }

    logToStderr();
    const store = await projectStore(args, deps);
    store.init();
    log.info('Hoist Docs serving over stdio', {
        version: config.version,
        libraries: Object.fromEntries(store.libraryIds().map(id => [id, store.versions(id)[0]]))
    });
    serveStdio(() => createMcpServer(store, config), {
        onerror: e => log.warn('MCP stdio error', errorData(e))
    });
}

/**
 * The indexes to serve: an explicit directory (--index-dir, else a non-empty INDEX_DIR), else
 * the project's own versions.
 */
async function projectStore(args: ParsedArgs, deps: CliDeps): Promise<IndexStore> {
    const indexDir = args.values['index-dir'] || process.env.INDEX_DIR;
    if (indexDir) return new IndexStore(indexDir);

    const root = resolve(args.values.project ?? '.'),
        versions = detectProjectVersions(root);
    versions.notes.forEach(note => log.warn(note));

    const wanted = Object.entries({react: versions.react, core: versions.core}).filter(
        (e): e is [string, string] => e[1] != null
    );
    if (!wanted.length) {
        throw new Error(
            `No Hoist versions found in ${root}: expected an installed @xh/hoist (client-app/node_modules) or hoistCoreVersion in gradle.properties. Run from the project root, or pass --project.`
        );
    }

    const resolver = new IndexResolver(deps.registry ?? new NpmRegistry(), deps.cacheDir),
        specs: IndexFileSpec[] = [];
    for (const [libraryId, version] of wanted) {
        specs.push({libraryId, version, path: await resolver.resolve(libraryId, version)});
    }
    return new IndexStore(specs);
}

/** Write `<out>/<libraryId>.json` docs payloads, plus `<out>/index.json` listing them. */
async function exportDocs(args: ParsedArgs, deps: CliDeps): Promise<void> {
    const out = args.values.out;
    if (!out) throw new Error('export-docs needs --out <dir>');

    if (args.checkouts.length) {
        const write = () =>
            writePayloads(
                out,
                args.checkouts.map(dir => docsFromCheckout(dir))
            );
        write();
        if (args.flags.has('watch')) await watchCheckouts(args.checkouts, write);
        return;
    }
    if (args.flags.has('watch')) throw new Error('--watch needs --from-checkout');

    const store = await projectStore(args, deps);
    writePayloads(
        out,
        store.libraryIds().map(id => extractDocs(LibraryIndex.readJson(store.filePath(id))))
    );
}

function writePayloads(out: string, payloads: DocsPayload[]): void {
    mkdirSync(out, {recursive: true});
    const manifest = payloads.map(payload => {
        const {id, name, version} = payload.library,
            file = `${id}.json`;
        writeFileSync(join(out, file), JSON.stringify(payload));
        log.info('Exported docs', {library: id, version, file: join(out, file)});
        return {id, name, version, file};
    });
    writeFileSync(join(out, 'index.json'), JSON.stringify(manifest, null, 2));
}

/**
 * Re-export whenever a doc or the registry changes, until interrupted. Watches only the folders
 * holding registered docs - not whole checkouts, whose `node_modules` would be costly to watch.
 */
async function watchCheckouts(checkouts: string[], write: () => void): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = (file: string | null) => {
        if (file && !/\.md$|doc-registry\.json$/.test(file)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            try {
                write();
            } catch (e) {
                log.warn('Re-export failed', errorData(e));
            }
        }, 200);
    };

    const dirs = new Set<string>();
    for (const checkout of checkouts) {
        const root = resolve(checkout);
        dirs.add(join(root, 'docs'));
        for (const e of docsFromCheckout(root).docs.entries) dirs.add(dirname(join(root, e.id)));
    }
    for (const dir of dirs) watch(dir, (_, file) => onChange(file));
    log.info('Watching docs for changes', {folders: dirs.size});
    await new Promise(() => {});
}

//------------------------
// Implementation
//------------------------
interface ParsedArgs {
    command: string | null;
    flags: Set<string>;
    values: Record<string, string>;
    /** Every --from-checkout given. */
    checkouts: string[];
}

const VALUE_OPTIONS = new Set(['project', 'index-dir', 'port', 'out']);

function parseArgs(argv: string[]): ParsedArgs {
    const ret: ParsedArgs = {command: null, flags: new Set(), values: {}, checkouts: []};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const [name, inline] = arg.slice(2).split('=', 2);
            if (name === 'from-checkout') ret.checkouts.push(inline ?? argv[++i]);
            else if (VALUE_OPTIONS.has(name)) ret.values[name] = inline ?? argv[++i];
            else ret.flags.add(name);
        } else if (!ret.command) {
            ret.command = arg;
        } else {
            throw new Error(`Unexpected argument: ${arg}\n${USAGE}`);
        }
    }
    if (ret.command && ret.command !== 'export-docs') {
        throw new Error(`Unknown command: ${ret.command}\n${USAGE}`);
    }
    return ret;
}

function packageVersion(): string {
    try {
        return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
            .version;
    } catch {
        return 'dev';
    }
}

/** Entry point: report failures on stderr and exit non-zero. */
export async function run(argv: string[]): Promise<void> {
    try {
        await main(argv);
    } catch (e) {
        log.debug('hoist-docs failed', errorData(e));
        process.stderr.write(`hoist-docs: ${(e as Error)?.message ?? e}\n`);
        process.exitCode = 1;
    }
}

if (import.meta.main) await run(process.argv.slice(2));
