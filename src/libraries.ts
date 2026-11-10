/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * The built-in libraries: those XH indexes centrally, publishing one index package per release.
 * Everything that needs to know which libraries exist reads this table - the local tool's version
 * detection, index fetching and display order, the docs library's labels, and the builders and
 * publishing scripts. Plain data, so the browser-safe docs library can import it.
 *
 * Order matters: it is the display order, and hoist-react comes first, so its doc ids win when
 * unqualified.
 */
export interface LibraryDef {
    /** Short id, used in tool arguments, doc id prefixes (`core:`) and index file names. */
    id: string;
    /** Display name, e.g. `Hoist React`. */
    label: string;
    /** Repo name, used as the docs viewer's source id, e.g. `hoist-react`. */
    source: string;
    /** Package name: an npm name, or Maven coordinates for hoist-core. */
    packageName: string;
    /** npm package holding the library's indexes. */
    indexPackage: string;
    /** Git repository, cloned to build indexes for its release tags. */
    repo: string;
    /** Oldest release indexed: the first with `docs/doc-registry.json`. */
    floor: string;
    /** Builder for the library's source. */
    builder: 'typescript' | 'groovy';
    /**
     * How an app's version is found: the installed npm package of that name, or a property in
     * `gradle.properties`.
     */
    installed: {npm: string} | {gradleProperty: string};
    /**
     * How a checkout of the library itself is recognized: the `name` in its `package.json`, or the
     * `rootProject.name` in its `settings.gradle`.
     */
    checkout: {packageName: string} | {gradleProject: string; versionProperty: string};
    /**
     * Folders under the checkout that hold no published source, left out of the index. The
     * typescript builder always skips its own housekeeping folders as well.
     */
    excludeDirs?: string[];
    /**
     * True for libraries an app is not expected to use without being asked: served only when
     * found installed, never as a `develop` default in another library's checkout.
     */
    optional?: boolean;
}

export const LIBRARIES: LibraryDef[] = [
    {
        id: 'react',
        label: 'Hoist React',
        source: 'hoist-react',
        packageName: '@xh/hoist',
        indexPackage: '@xh/hoist-docs-index-react',
        repo: 'https://github.com/xh/hoist-react.git',
        floor: '83.0.0',
        builder: 'typescript',
        installed: {npm: '@xh/hoist'},
        checkout: {packageName: '@xh/hoist'}
    },
    {
        id: 'core',
        label: 'Hoist Core',
        source: 'hoist-core',
        packageName: 'io.xh:hoist-core',
        indexPackage: '@xh/hoist-docs-index-core',
        repo: 'https://github.com/xh/hoist-core.git',
        floor: '37.0.0',
        builder: 'groovy',
        installed: {gradleProperty: 'hoistCoreVersion'},
        checkout: {gradleProject: 'hoist-core', versionProperty: 'xhReleaseVersion'}
    },
    {
        id: 'chat-kit',
        label: 'Hoist Chat Kit',
        source: 'hoist-chat-kit',
        packageName: '@xh/hoist-chat-kit',
        indexPackage: '@xh/hoist-docs-index-chat-kit',
        repo: 'https://github.com/xh/hoist-chat-kit.git',
        floor: '1.0.0',
        builder: 'typescript',
        installed: {npm: '@xh/hoist-chat-kit'},
        checkout: {packageName: '@xh/hoist-chat-kit'},
        excludeDirs: ['test'],
        optional: true
    }
];

/** The built-in library with this id, if any. */
export function libraryDef(id: string): LibraryDef | undefined {
    return LIBRARIES.find(l => l.id === id);
}
