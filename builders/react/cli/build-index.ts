/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * Build the Hoist Docs index file for a TypeScript library: hoist-react, hoist-chat-kit, or any
 * library that declares itself in its `package.json`:
 *
 *   "hoistDocs": {"id": "acme", "index": "hoist-docs/index.json.gz", "exclude": ["test"]}
 *
 * Writes one JSON file (schema v1, see `docs/index-schema.md`) holding the doc registry and
 * markdown, every indexed symbol with its detail and members precomputed, and the member search
 * index. The Hoist Docs tool reads this file; it never parses library source.
 *
 * A library runs it from its `prepack` script, so the index ships inside its npm package:
 *
 *   hoist-docs-build --root . --file hoist-docs/index.json.gz
 *
 * Options: `--root <checkout>` (default: current directory), `--library <id>`, `--version <v>`
 * (default: the checkout's `package.json` version, as set by the publish job), and the output -
 * `--file <path>` (gzipped when it ends `.gz`), else `--out <dir>` (default `indexes`) with
 * `--gzip`, writing `<id>-<version>.json[.gz]`. The checkout needs its dependencies installed, for
 * type resolution.
 */
import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {gzipSync} from 'node:zlib';

import {loadDocContent, loadRegistry, parseInstructions} from '../data/doc-registry.ts';
import {log} from '../util/logger.ts';
import {
    getIndexes,
    getMembers,
    getSymbolDetail,
    isPromiseExtension,
    type MemberIndexEntry,
    type SymbolEntry
} from '../data/ts-registry.ts';
import {
    readPackageJson,
    resolveRepoRoot,
    resolveRepoRootPosix,
    setLibraryOptions,
    setRepoRoot
} from '../util/paths.ts';

export const SCHEMA_VERSION = 1;

/**
 * XH libraries built before they declared `hoistDocs` in their `package.json`, by package name.
 * A declaration in the checkout wins.
 */
const KNOWN_LIBRARIES: Record<string, {id: string; exclude?: string[]}> = {
    '@xh/hoist': {id: 'react'},
    '@xh/hoist-chat-kit': {id: 'chat-kit', exclude: ['test']}
};

/** The library a checkout's `package.json` describes: its id, import prefix and excluded dirs. */
export function libraryOptions(
    pkg: any,
    libraryId?: string
): {id: string; importPrefix: string; excludeDirs: string[]} {
    const name: string | undefined = pkg?.name,
        declared = pkg?.hoistDocs,
        known = name ? KNOWN_LIBRARIES[name] : undefined,
        id = libraryId ?? declared?.id ?? known?.id;
    if (!name || !id) {
        throw new Error(
            'Not a library this builder recognizes: its package.json needs a name and a "hoistDocs": {"id": ...} entry.'
        );
    }
    return {id, importPrefix: name, excludeDirs: declared?.exclude ?? known?.exclude ?? []};
}

/**
 * Build the index object in memory. Pass the release version when building a tag: tagged commits
 * carry the next snapshot version in `package.json`, the release version being set at publish.
 */
export async function buildIndex(version?: string, libraryId?: string): Promise<object> {
    const repoRoot = resolveRepoRoot(),
        posixRoot = resolveRepoRootPosix(),
        rel = (p: string) => (p.startsWith(posixRoot + '/') ? p.slice(posixRoot.length + 1) : p),
        pkg = readPackageJson(repoRoot),
        lib = libraryOptions(pkg, libraryId);
    setLibraryOptions({importPrefix: lib.importPrefix, excludeDirs: lib.excludeDirs});

    // Docs - the checkout's own registry only. Each library builds its own index.
    const registry = loadRegistry(),
        rawRegistry = JSON.parse(
            loadDocContent({filePath: resolve(repoRoot, 'docs/doc-registry.json')} as any)
        ),
        viewerCategoryById = new Map<string, string>(
            rawRegistry.entries.map((e: any) => [e.id, e.viewerCategory])
        );

    const docEntries = registry.entries
        .filter(e => e.library == null)
        .map(e => ({
            id: e.id,
            title: e.title,
            mcpCategory: e.mcpCategory,
            viewerCategory: viewerCategoryById.get(e.id) ?? null,
            description: e.description,
            keywords: e.keywords,
            aliases: e.aliases,
            markdown: loadDocContent(e)
        }));

    // Symbols - every entry, with detail and (for classes and interfaces) all members.
    const {symbols, members} = await getIndexes(),
        allEntries: SymbolEntry[] = [...symbols.values()].flat(),
        outSymbols = [];

    for (const entry of allEntries) {
        const detail = await getSymbolDetail(entry.name, {
            filePath: entry.filePath,
            kind: entry.kind
        });
        const sym: any = {
            name: entry.name,
            kind: entry.kind,
            filePath: rel(entry.filePath),
            sourcePackage: entry.sourcePackage,
            isExported: entry.isExported,
            importPath: entry.importPath,
            isPromiseExtension: isPromiseExtension(entry) || undefined,
            doc: entry.jsDoc,
            hint: entry.mcpHint,
            memberNames: entry.memberNames || undefined,
            signature: detail?.signature ?? '',
            extends: detail?.extends,
            implements: detail?.implements?.length ? detail.implements : undefined,
            decorators: detail?.decorators?.length ? detail.decorators : undefined,
            constructorType: detail?.constructorType,
            instanceOf: detail?.instanceOf
        };

        if (entry.kind === 'class' || entry.kind === 'interface') {
            const result = await getMembers(entry.name, {filePath: entry.filePath});
            if (result.ok && result.symbol.filePath === entry.filePath) {
                sym.members = result.members.map(m => ({
                    name: m.name,
                    kind: m.kind,
                    type: m.type,
                    isStatic: m.isStatic,
                    isOptional: m.isOptional,
                    decorators: m.decorators,
                    doc: m.jsDoc,
                    default: m.default,
                    parameters: m.parameters,
                    returnType: m.returnType,
                    returns: m.returns,
                    inheritedFrom: m.inheritedFrom,
                    docInheritedFrom: m.jsDocInheritedFrom
                }));
                if (result.externalMembers.length) sym.externalMembers = result.externalMembers;
            }
        }
        outSymbols.push(sym);
    }

    const memberIndex = [...members.values()].flat().map((m: MemberIndexEntry) => ({
        name: m.name,
        memberKind: m.memberKind,
        ownerName: m.ownerName,
        ownerHint: m.ownerHint,
        filePath: rel(m.filePath),
        sourcePackage: m.sourcePackage,
        isStatic: m.isStatic,
        type: m.type,
        doc: m.jsDoc,
        docInheritedFrom: m.jsDocInheritedFrom,
        default: m.default,
        decorators: m.decorators
    }));

    // hoist-react's guidance is the server instructions themselves; another library's comes from
    // its registry's `mcpInstructions`.
    const instructions =
        lib.id === 'react'
            ? null
            : parseInstructions(rawRegistry.mcpInstructions, msg => log.warn(msg));
    return {
        schemaVersion: SCHEMA_VERSION,
        library: {
            id: lib.id,
            name: lib.importPrefix,
            version: version ?? pkg?.version ?? 'unknown',
            language: 'typescript',
            gitSha: gitSha(repoRoot),
            builtAt: new Date().toISOString(),
            description: pkg?.description ?? null,
            ...(instructions ? {instructions} : {})
        },
        docs: {
            mcpCategories: registry.mcpCategories,
            viewerCategories: rawRegistry.viewerCategories ?? [],
            entries: docEntries
        },
        symbols: outSymbols,
        memberIndex
    };
}

function gitSha(dir: string): string | null {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: dir, encoding: 'utf8'}).trim();
    } catch {
        return null;
    }
}

//------------------------------------------------------------------
// CLI entry point
//------------------------------------------------------------------
export async function main(args: string[]): Promise<void> {
    const arg = (name: string) => {
        const i = args.indexOf(name);
        return i >= 0 ? args[i + 1] : undefined;
    };

    setRepoRoot(arg('--root') ?? '.');

    const start = Date.now(),
        index: any = await buildIndex(arg('--version'), arg('--library')),
        json = JSON.stringify(index),
        file = arg('--file'),
        gzip = file ? file.endsWith('.gz') : args.includes('--gzip'),
        outPath = file
            ? resolve(file)
            : resolve(
                  arg('--out') ?? 'indexes',
                  `${index.library.id}-${index.library.version}.json${gzip ? '.gz' : ''}`
              );

    mkdirSync(dirname(outPath), {recursive: true});
    writeFileSync(outPath, gzip ? gzipSync(json) : json);

    console.log(
        `Wrote ${outPath}: ${index.docs.entries.length} docs, ${index.symbols.length} symbols, ` +
            `${index.memberIndex.length} member index entries, ` +
            `${(json.length / 1e6).toFixed(1)} MB JSON in ${((Date.now() - start) / 1000).toFixed(1)}s`
    );
}

/** Entry point for `bin/hoist-docs-build.mjs`: report failures on stderr and exit non-zero. */
export async function run(args: string[]): Promise<void> {
    try {
        await main(args);
    } catch (e) {
        process.stderr.write(`hoist-docs-build: ${(e as Error)?.message ?? e}\n`);
        process.exitCode = 1;
    }
}

if (import.meta.main) await run(process.argv.slice(2));
