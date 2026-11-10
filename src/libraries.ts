/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * The built-in libraries: XH's own. Each ships its index with itself - inside its npm package, or
 * beside its jar on Maven - so the tool can serve any library that does, listed here or not. This
 * table adds what only XH's libraries get: labels and display order, where the local tool finds
 * their versions (including in their own checkouts), which libraries a project cannot do without,
 * and how a gateway fetches them on demand. Plain data, so the browser-safe docs library can import
 * it.
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
    /**
     * Maven coordinates, for a library that ships its index beside its jar as the `docs-index`
     * artifact. Absent for npm libraries, which ship it inside their package.
     */
    maven?: {group: string; artifact: string};
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
     * True for libraries an app is not expected to use without being asked: served only when
     * found installed, never as a default in another library's checkout, and skipped with a
     * warning when its index cannot be found.
     */
    optional?: boolean;
}

export const LIBRARIES: LibraryDef[] = [
    {
        id: 'react',
        label: 'Hoist React',
        source: 'hoist-react',
        packageName: '@xh/hoist',
        installed: {npm: '@xh/hoist'},
        checkout: {packageName: '@xh/hoist'}
    },
    {
        id: 'core',
        label: 'Hoist Core',
        source: 'hoist-core',
        packageName: 'io.xh:hoist-core',
        maven: {group: 'io.xh', artifact: 'hoist-core'},
        installed: {gradleProperty: 'hoistCoreVersion'},
        checkout: {gradleProject: 'hoist-core', versionProperty: 'xhReleaseVersion'}
    },
    {
        id: 'chat-kit',
        label: 'Hoist Chat Kit',
        source: 'hoist-chat-kit',
        packageName: '@xh/hoist-chat-kit',
        installed: {npm: '@xh/hoist-chat-kit'},
        checkout: {packageName: '@xh/hoist-chat-kit'},
        optional: true
    }
];

/** The built-in library with this id, if any. */
export function libraryDef(id: string): LibraryDef | undefined {
    return LIBRARIES.find(l => l.id === id);
}
