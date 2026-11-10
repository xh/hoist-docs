/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * Shapes of an index file, as written by each library's index builder. See
 * docs/index-schema.md for the full description of each field.
 */

export const SCHEMA_VERSION = 1;

export interface IndexFile {
    schemaVersion: number;
    library: LibraryInfo;
    docs: {
        mcpCategories?: Category[];
        viewerCategories?: Category[];
        entries: DocEntryJson[];
    };
    symbols?: SymbolEntry[];
    memberIndex?: MemberIndexEntry[];
}

export interface LibraryInfo {
    /** Short id used in tool arguments: `react`, `core`, or a companion id. */
    id: string;
    /** Package name, e.g. `@xh/hoist`. */
    name: string;
    version: string;
    language: 'typescript' | 'groovy';
    gitSha?: string;
    builtAt: string;
    description?: string;
    instructions?: string;
}

export interface Category {
    id: string;
    title: string;
}

export interface DocEntryJson {
    id: string;
    title: string;
    mcpCategory: string;
    viewerCategory: string;
    description?: string;
    keywords?: string[];
    aliases?: string[];
    markdown?: string;
}

export type SymbolKind =
    'class' | 'interface' | 'type' | 'function' | 'const' | 'enum' | 'trait' | 'annotation';

export type MemberKind = 'property' | 'method' | 'accessor' | 'field';

export interface Parameter {
    name: string;
    type: string;
    description?: string;
}

export interface Member {
    name: string;
    kind: MemberKind;
    type: string;
    isStatic: boolean;
    isOptional?: boolean;
    isAbstract?: boolean;
    visibility?: string;
    decorators?: string[];
    doc?: string;
    default?: string;
    parameters?: Parameter[];
    returnType?: string;
    returns?: {type: string; description: string};
    inheritedFrom?: string;
    docInheritedFrom?: string;
}

export interface ExternalMemberGroup {
    declaredIn: string;
    module: string | null;
    members: Array<{name: string; kind: string; type?: string}>;
}

export interface SymbolEntry {
    name: string;
    kind: SymbolKind;
    filePath: string;
    sourcePackage: string;
    category?: string;
    isExported: boolean;
    isAbstract?: boolean;
    importPath?: string | null;
    isPromiseExtension?: boolean;
    doc?: string;
    hint?: string;
    memberNames?: string;
    signature: string;
    extends?: string;
    implements?: string[];
    decorators?: string[];
    constructorType?: string;
    instanceOf?: string;
    members?: Member[];
    externalMembers?: ExternalMemberGroup[];
}

export interface MemberIndexEntry {
    name: string;
    memberKind: MemberKind;
    ownerName: string;
    ownerHint?: string;
    filePath: string;
    sourcePackage: string;
    isStatic: boolean;
    type: string;
    doc?: string;
    docInheritedFrom?: string;
    default?: string;
    decorators?: string[];
    parameters?: Parameter[];
}
