/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * Index packages: one npm package per library, one version per library release, each holding a
 * single gzipped index file. See "Index format and build pipeline" in docs/design.md.
 */

/** npm package holding each library's indexes. */
export const INDEX_PACKAGES: Record<string, string> = {
    react: '@xh/hoist-react-docs-index',
    core: '@xh/hoist-core-docs-index'
};

/** Path of the index file inside an index package tarball. */
export const INDEX_FILE_IN_PACKAGE = 'package/index.json.gz';

/** dist-tag pointing at the index built from each library's `develop` branch. */
export const DEVELOP_TAG = 'develop';

/**
 * The package version to use for a library release: the release itself, or its highest revision.
 * npm versions are immutable, so a rebuilt index publishes as `<release>-r2`, `-r3`, and so on.
 * Returns null if the release has no published index.
 */
export function pickRevision(published: string[], release: string): string | null {
    let best: string | null = null,
        bestRev = 0;
    for (const v of published) {
        let rev = 0;
        if (v === release) rev = 1;
        else {
            const m = /^(.+)-r(\d+)$/.exec(v);
            if (m && m[1] === release) rev = parseInt(m[2]);
        }
        if (rev > bestRev) [best, bestRev] = [v, rev];
    }
    return best;
}

/** The package version for a rebuild of `release`, given what is already published. */
export function nextRevision(published: string[], release: string): string {
    const current = pickRevision(published, release);
    if (!current) return release;
    const m = /-r(\d+)$/.exec(current);
    return `${release}-r${m ? parseInt(m[1]) + 1 : 2}`;
}
