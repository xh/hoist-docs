/**
 * Small synthetic index files for tests. `writeIndexDir` writes them to a temp directory laid out
 * as the service expects (`<libraryId>-<version>.json[.gz]`).
 */
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';

import type {DocEntryJson, IndexFile, Member, SymbolEntry} from '../src/index/types.ts';

const CATEGORIES = [
    {id: 'package', title: 'Package Documentation'},
    {id: 'concept', title: 'Concept Documentation'},
    {id: 'index', title: 'Index'}
];

const GRID_README = `# Grid Package

The grid package renders tabular data with sorting, grouping and selection.

## Overview

A GridModel holds the grid's store, columns and selection. Use persistWith to save column state.

## Sorting

### Default Sort

Pass sortBy to the GridModel config to apply an initial sort to the grid data.

### Custom Comparators

Columns accept a comparator function for custom sorting of their values.

## Selection

Selection is managed by a StoreSelectionModel on the GridModel.

### Default Sort

A second heading with the same name, to exercise ambiguous section lookups here.
`;

const PERSISTENCE = `# Persistence

Hoist models can persist state to local storage, preferences or views.

## Using persistWith

Set persistWith on a model to choose where its state is saved and restored.
`;

const UPGRADE_NOTES = `# v85 Upgrade Notes

## Breaking Changes

The grid sortBy config now requires GridSorter specs, a change for every grid.
`;

const INDEX_DOC = `# Documentation Index

Catalog of every doc: grid, persistence, upgrade notes and more.
`;

function doc(
    id: string,
    title: string,
    markdown: string,
    extra: Partial<DocEntryJson> = {}
): DocEntryJson {
    return {
        id,
        title,
        mcpCategory: 'package',
        viewerCategory: 'components',
        description: `${title} docs.`,
        keywords: [],
        aliases: [],
        markdown,
        ...extra
    };
}

function member(name: string, extra: Partial<Member> = {}): Member {
    return {
        name,
        kind: 'property',
        type: 'string',
        isStatic: false,
        decorators: [],
        doc: '',
        ...extra
    };
}

function symbol(name: string, extra: Partial<SymbolEntry> = {}): SymbolEntry {
    return {
        name,
        kind: 'class',
        filePath: `cmp/grid/${name}.ts`,
        sourcePackage: 'cmp/grid',
        isExported: true,
        importPath: '@xh/hoist/cmp/grid',
        doc: '',
        signature: `export class ${name}`,
        ...extra
    };
}

export function reactIndex(version: string = '90.0.0'): IndexFile {
    const gridMembers = [
        member('sortBy', {
            type: 'GridSorter[]',
            default: '[]',
            doc: 'Initial sort to apply to grid data.'
        }),
        member('setSortBy', {
            kind: 'method',
            type: 'void',
            returnType: 'void',
            parameters: [
                {name: 'sorters', type: 'GridSorterLike[]', description: 'Sorts to apply.'}
            ],
            doc: 'Sort this grid.'
        }),
        member('persistWith', {
            type: 'PersistOptions',
            isOptional: true,
            inheritedFrom: 'HoistModel'
        })
    ];
    return {
        schemaVersion: 1,
        library: {
            id: 'react',
            name: '@xh/hoist',
            version,
            language: 'typescript',
            builtAt: '2026-11-01T00:00:00Z'
        },
        docs: {
            mcpCategories: CATEGORIES,
            viewerCategories: [{id: 'components', title: 'Components'}],
            entries: [
                doc('docs/README.md', 'Documentation Index', INDEX_DOC, {
                    mcpCategory: 'index',
                    aliases: ['index']
                }),
                doc('cmp/grid/README.md', 'Grid Package', GRID_README, {
                    keywords: ['grid', 'table']
                }),
                doc('docs/persistence.md', 'Persistence', PERSISTENCE, {mcpCategory: 'concept'}),
                doc('docs/upgrade-notes/v85-upgrade-notes.md', 'v85 Upgrade Notes', UPGRADE_NOTES)
            ]
        },
        symbols: [
            symbol('GridModel', {
                doc: 'Core Model for a Grid. Holds store, columns and selection.',
                memberNames: 'sortBy setSortBy',
                extends: 'HoistModel',
                members: gridMembers
            }),
            symbol('GridSorter', {doc: 'A sort on one grid column.', members: []}),
            symbol('Grid', {
                kind: 'const',
                filePath: 'cmp/grid/Grid.ts',
                signature: 'export const [Grid, grid] = ...',
                doc: 'Grid component.'
            }),
            symbol('grid', {
                kind: 'const',
                filePath: 'cmp/grid/Grid.ts',
                signature: 'export const [Grid, grid] = ...',
                doc: 'Grid factory.'
            }),
            symbol('GridProps', {
                kind: 'interface',
                filePath: 'cmp/grid/Grid.ts',
                doc: 'Props for Grid.',
                members: [member('model')]
            }),
            symbol('GridLocalModel', {
                filePath: 'cmp/grid/impl/GridLocalModel.ts',
                importPath: null,
                doc: 'Internal model for Grid.'
            }),
            symbol('FieldType', {
                kind: 'const',
                filePath: 'data/Field.ts',
                sourcePackage: 'data',
                importPath: '@xh/hoist/data'
            }),
            symbol('FieldType', {
                kind: 'type',
                filePath: 'data/Field.ts',
                sourcePackage: 'data',
                importPath: '@xh/hoist/data',
                signature: 'export type FieldType = ...'
            })
        ],
        memberIndex: gridMembers
            .filter(m => !m.inheritedFrom)
            .map(m => ({
                name: m.name,
                memberKind: m.kind,
                ownerName: 'GridModel',
                filePath: 'cmp/grid/GridModel.ts',
                sourcePackage: 'cmp/grid',
                isStatic: m.isStatic,
                type: m.type,
                doc: m.doc,
                decorators: []
            }))
    };
}

export function coreIndex(version: string = '40.0'): IndexFile {
    return {
        schemaVersion: 1,
        library: {
            id: 'core',
            name: 'io.xh:hoist-core',
            version,
            language: 'groovy',
            builtAt: '2026-11-01T00:00:00Z'
        },
        docs: {
            mcpCategories: CATEGORIES,
            viewerCategories: [{id: 'concepts', title: 'Concepts'}],
            entries: [
                doc('docs/README.md', 'Documentation Index', INDEX_DOC, {mcpCategory: 'index'}),
                doc(
                    'docs/caching.md',
                    'Caching',
                    '# Caching\n\n## Cache\n\nA Cache holds computed values in memory, replicated across the cluster.\n',
                    {mcpCategory: 'concept', viewerCategory: 'concepts'}
                )
            ]
        },
        symbols: [
            {
                name: 'BaseService',
                kind: 'class',
                filePath: 'src/main/groovy/io/xh/hoist/BaseService.groovy',
                sourcePackage: 'io.xh.hoist',
                isExported: true,
                doc: 'Standard superclass for all Hoist services.',
                signature: 'abstract class BaseService',
                members: [member('init', {kind: 'method', type: 'void'})]
            }
        ],
        memberIndex: []
    };
}

/** Write index files to a new temp directory and return its path. */
export function writeIndexDir(files: Record<string, IndexFile>): string {
    const dir = mkdtempSync(join(tmpdir(), 'hoist-docs-test-'));
    for (const [name, json] of Object.entries(files)) {
        const text = JSON.stringify(json);
        writeFileSync(join(dir, name), name.endsWith('.gz') ? gzipSync(text) : text);
    }
    return dir;
}
