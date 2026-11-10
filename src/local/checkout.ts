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

const CORE_DESCRIPTION =
    'Server half of the Hoist toolkit: a Grails plugin providing services, controllers, caching, clustering, config, prefs, roles and monitoring.';

/** The library a checkout holds: `react`, `core`, or null if neither. */
export function checkoutLibrary(dir: string): 'react' | 'core' | null {
    const pkg = readJson(join(dir, 'package.json'));
    if (pkg?.name === '@xh/hoist') return 'react';
    const settings = join(dir, 'settings.gradle');
    if (
        existsSync(settings) &&
        /rootProject\.name\s*=\s*'hoist-core'/.test(readFileSync(settings, 'utf8'))
    ) {
        return 'core';
    }
    return null;
}

/** The docs payload of a hoist-react or hoist-core checkout. */
export function docsFromCheckout(checkout: string): DocsPayload {
    const dir = resolve(checkout),
        libraryId = checkoutLibrary(dir);
    if (!libraryId) throw new Error(`${dir} is not a hoist-react or hoist-core checkout`);

    const registry = readJson(join(dir, 'docs/doc-registry.json'));
    if (!registry) throw new Error(`No docs/doc-registry.json in ${dir}`);
    return libraryId === 'react' ? reactPayload(dir, registry) : corePayload(dir, registry);
}

//------------------------
// hoist-react - as builders/react (doc-registry.ts loadLibrary, cli/build-index.ts)
//------------------------
function reactPayload(dir: string, registry: any): DocsPayload {
    const pkg = readJson(join(dir, 'package.json')),
        realRoot = realpathSync(dir),
        entries: DocEntryJson[] = [];

    for (const raw of array(registry.entries)) {
        if (typeof raw?.id !== 'string' || !raw.id) continue;
        // Docs for hoist-react's own maintainers, served only inside hoist-react.
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

    return {
        schemaVersion: SCHEMA_VERSION,
        library: {
            id: 'react',
            name: pkg?.name ?? '@xh/hoist',
            version: pkg?.version ?? 'unknown',
            language: 'typescript',
            gitSha: gitSha(dir) ?? undefined,
            builtAt: new Date().toISOString(),
            description: pkg?.description ?? undefined
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
