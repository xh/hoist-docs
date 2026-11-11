/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * Keep `./indexes` built from library checkouts, for serving them while you work on the libraries
 * or on the builders (`HOIST_DOCS_INDEX_DIR` pointed at `./indexes`; the tool picks up rebuilt
 * files within seconds, without a restart).
 *
 *   pnpm build:watch [--root <checkout> ...]
 *
 * Builds every checkout once, then rebuilds one whenever its docs or source change, and all of
 * them whenever their builder here changes. Defaults to the sibling hoist-react, hoist-core and
 * hoist-chat-kit checkouts that exist.
 */
import {spawn} from 'node:child_process';
import {existsSync, readFileSync, watch} from 'node:fs';
import {join, resolve} from 'node:path';

const REPO = resolve(import.meta.dirname, '..'),
    OUT = join(REPO, 'indexes'),
    SOURCE_FILE = /\.(tsx?|md|json|groovy|java)$/,
    IGNORED = /(^|\/)(node_modules|build|dist|out|bin|coverage|\.[^/]+|hoist-docs|indexes)(\/|$)/,
    DEBOUNCE_MS = 1000;

interface Checkout {
    root: string;
    kind: 'typescript' | 'groovy';
    building: boolean;
    pending: boolean;
    /** The last changed file, reported with the rebuild. */
    trigger?: string;
    timer?: ReturnType<typeof setTimeout>;
}

const roots = rootsFromArgs(process.argv.slice(2)),
    checkouts: Checkout[] = roots.map(root => ({
        root,
        kind: existsSync(join(root, 'settings.gradle')) ? 'groovy' : 'typescript',
        building: false,
        pending: false
    }));
if (!checkouts.length) {
    console.error(
        'No checkouts found - pass --root <checkout>, or check out the libraries beside hoist-docs.'
    );
    process.exit(1);
}

for (const c of checkouts) {
    schedule(c, 0);
    watch(c.root, {recursive: true}, (_, file) => {
        if (file && SOURCE_FILE.test(file) && !IGNORED.test(file)) {
            c.trigger = file;
            schedule(c);
        }
    });
}
for (const [kind, dir] of [
    ['typescript', 'builders/react'],
    ['groovy', 'builders/core/src']
] as const) {
    watch(join(REPO, dir), {recursive: true}, (_, file) => {
        if (file && SOURCE_FILE.test(file) && !IGNORED.test(file)) {
            checkouts.filter(c => c.kind === kind).forEach(c => schedule(c));
        }
    });
}
console.log(`Watching ${roots.join(', ')} - indexes in ${OUT}`);

//------------------------
// Implementation
//------------------------
function schedule(c: Checkout, delay = DEBOUNCE_MS): void {
    clearTimeout(c.timer);
    c.timer = setTimeout(() => build(c), delay);
}

function build(c: Checkout): void {
    if (c.building) {
        c.pending = true;
        return;
    }
    c.building = true;
    const trigger = c.trigger;
    c.trigger = undefined;
    const [cmd, args] =
        c.kind === 'groovy'
            ? [join(REPO, 'builders/core/build-index.sh'), ['--root', c.root, '--out', OUT]]
            : [
                  process.execPath,
                  [join(REPO, 'builders/react/cli/build-index.ts'), '--root', c.root, '--out', OUT]
              ];
    const child = spawn(cmd, args, {cwd: REPO, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    child.stdout.on('data', d => (output += d));
    child.stderr.on('data', d => (output += d));
    child.on('close', code => {
        const time = new Date().toLocaleTimeString(),
            wrote = /Wrote (.*)/.exec(output)?.[1];
        if (code === 0) {
            console.log(
                `[${time}] ${wrote ?? `Rebuilt ${c.root}`}${trigger ? ` (${trigger} changed)` : ''}`
            );
        } else console.error(`[${time}] Build failed for ${c.root}:\n${output.trim()}`);
        c.building = false;
        if (c.pending) {
            c.pending = false;
            build(c);
        }
    });
}

function rootsFromArgs(args: string[]): string[] {
    const given = args.flatMap((a, i) =>
        a === '--root' && args[i + 1] ? [resolve(args[i + 1])] : []
    );
    if (given.length) return given;
    return ['hoist-react', 'hoist-core', 'hoist-chat-kit']
        .map(name => resolve(REPO, '..', name))
        .filter(dir => existsSync(join(dir, 'docs/doc-registry.json')) && isLibrary(dir));
}

function isLibrary(dir: string): boolean {
    try {
        return (
            existsSync(join(dir, 'settings.gradle')) ||
            !!JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name
        );
    } catch {
        return false;
    }
}
