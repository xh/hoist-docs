/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * Docs payloads read straight from a library checkout, for `hoist-docs export-docs
 * --from-checkout`. The docs part of an index is only `docs/doc-registry.json` plus the markdown
 * it lists, so this needs no install, no ts-morph and no JVM - it takes a second or two, which
 * keeps live preview of uncommitted doc edits in a docs viewer.
 *
 * Applies the same rules as each library's builder (`builders/`), so the payload equals the docs
 * part of an index built from the same checkout; a spec checks this against real checkouts.
 */
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, realpathSync} from 'node:fs';
import {join, resolve, sep} from 'node:path';

import type {DocsPayload} from '../docs/index.ts';
import {SCHEMA_VERSION, type Category, type DocEntryJson} from '../index/types.ts';
import {LIBRARIES, type LibraryDef} from '../libraries.ts';

const CORE_DESCRIPTION =
    'Server half of the Hoist toolkit: a Grails plugin providing services, controllers, caching, clustering, config, prefs, roles and monitoring.';

/** The built-in library a checkout holds, or null if none. */
export function checkoutLibrary(dir: string): LibraryDef | null {
    const pkg = readJson(join(dir, 'package.json')),
        settings = join(dir, 'settings.gradle'),
        gradleName = existsSync(settings)
            ? /rootProject\.name\s*=\s*'([^']+)'/.exec(readFileSync(settings, 'utf8'))?.[1]
            : null;
    return (
        LIBRARIES.find(l =>
            'packageName' in l.checkout
                ? pkg?.name === l.checkout.packageName
                : gradleName === l.checkout.gradleProject
        ) ?? null
    );
}

/** The docs payload of a checkout of a built-in library. */
export function docsFromCheckout(checkout: string): DocsPayload {
    const dir = resolve(checkout),
        lib = checkoutLibrary(dir);
    if (!lib) {
        throw new Error(
            `${dir} is not a checkout of ${LIBRARIES.map(l => l.source).join(', ')} (no matching package.json or settings.gradle)`
        );
    }

    const registry = readJson(join(dir, 'docs/doc-registry.json'));
    if (!registry) throw new Error(`No docs/doc-registry.json in ${dir}`);
    return lib.builder === 'typescript'
        ? typescriptPayload(dir, registry, lib)
        : corePayload(dir, registry);
}

//------------------------
// TypeScript libraries - as builders/react (doc-registry.ts loadLibrary, cli/build-index.ts)
//------------------------
function typescriptPayload(dir: string, registry: any, lib: LibraryDef): DocsPayload {
    const pkg = readJson(join(dir, 'package.json')),
        realRoot = realpathSync(dir),
        entries: DocEntryJson[] = [];

    for (const raw of array(registry.entries)) {
        if (typeof raw?.id !== 'string' || !raw.id) continue;
        // Docs for the library's own maintainers, served only inside its repo.
        if (raw.mcpAudience === 'maintainers') continue;
        if (raw.id.includes('..')) continue;
        const file = join(dir, raw.id);
        if (!existsSync(file) || !realpathSync(file).startsWith(realRoot + sep)) continue;
        entries.push({
            id: raw.id,
            title: str(raw.title, raw.id),
            mcpCategory: str(raw.mcpCategory, 'package'),
            viewerCategory: raw.viewerCategory ?? null,
            description: str(raw.description, ''),
            keywords: strings(raw.keywords),
            aliases: strings(raw.aliases),
            markdown: readFileSync(file, 'utf8')
        });
    }

    // Categories the registry declares, then any an entry uses without declaring.
    const mcpCategories: Category[] = array(registry.mcpCategories)
        .filter((c: any) => typeof c?.id === 'string' && c.id)
        .map((c: any) => ({id: c.id, title: str(c.title, c.id)}));
    for (const id of new Set(entries.map(e => e.mcpCategory))) {
        if (!mcpCategories.some(c => c.id === id)) {
            mcpCategories.push({id, title: id.charAt(0).toUpperCase() + id.slice(1)});
        }
    }

    const instructions = lib.id === 'react' ? null : parseInstructions(registry.mcpInstructions);
    return {
        schemaVersion: SCHEMA_VERSION,
        library: {
            id: lib.id,
            name: pkg?.name ?? lib.packageName,
            version: pkg?.version ?? 'unknown',
            language: 'typescript',
            gitSha: gitSha(dir) ?? undefined,
            builtAt: new Date().toISOString(),
            description: pkg?.description ?? undefined,
            ...(instructions ? {instructions} : {})
        },
        docs: {mcpCategories, viewerCategories: registry.viewerCategories ?? [], entries}
    };
}

//------------------------
// hoist-core - as builders/core (IndexBuilder.build)
//------------------------
function corePayload(dir: string, registry: any): DocsPayload {
    const entries: DocEntryJson[] = array(registry.entries)
        .filter((e: any) => existsSync(join(dir, e.id)))
        .map((e: any) => ({
            id: e.id,
            title: e.title,
            mcpCategory: e.mcpCategory,
            viewerCategory: e.viewerCategory,
            description: e.description || '',
            keywords: e.keywords || [],
            aliases: e.aliases || [],
            markdown: readFileSync(join(dir, e.id), 'utf8')
        }));

    const props = readFileSync(join(dir, 'gradle.properties'), 'utf8'),
        version = /^xhReleaseVersion=(\S+)/m.exec(props)?.[1] ?? 'unknown',
        sha = gitSha(dir);
    return {
        schemaVersion: SCHEMA_VERSION,
        library: {
            id: 'core',
            name: 'io.xh:hoist-core',
            version,
            language: 'groovy',
            ...(sha ? {gitSha: sha} : {}),
            builtAt: new Date().toISOString(),
            description: CORE_DESCRIPTION
        },
        docs: {
            mcpCategories: registry.mcpCategories || [],
            viewerCategories: registry.viewerCategories || [],
            entries
        }
    };
}

//------------------------
// Implementation
//------------------------
/** Longest library guidance accepted, as builders/react `MAX_LIBRARY_INSTRUCTIONS_CHARS`. */
const MAX_INSTRUCTIONS_CHARS = 1500;

/** `mcpInstructions` as trimmed, non-empty lines, as builders/react `parseInstructions`. */
function parseInstructions(raw: unknown): string | null {
    const valid =
        typeof raw === 'string' || (Array.isArray(raw) && raw.every(it => typeof it === 'string'));
    if (!valid) return null;
    const text = [raw]
        .flat()
        .join('\n')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .join('\n');
    if (text.length <= MAX_INSTRUCTIONS_CHARS) return text || null;
    return text.slice(0, MAX_INSTRUCTIONS_CHARS - 3) + '...';
}

function readJson(path: string): any {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return null;
    }
}

function array(v: unknown): any[] {
    return Array.isArray(v) ? v : [];
}

function str(v: unknown, dflt: string): string {
    return typeof v === 'string' ? v : dflt;
}

function strings(v: unknown): string[] {
    return Array.isArray(v) ? v.filter(s => typeof s === 'string') : [];
}

function gitSha(dir: string): string | null {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: dir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
    } catch {
        return null;
    }
}
