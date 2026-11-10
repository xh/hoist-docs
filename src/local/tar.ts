import {gunzipSync} from 'node:zlib';

/**
 * Read one file out of a gzipped tar (an npm package tarball), or return null if it is not
 * there. Handles the plain ustar entries npm writes; enough for index packages, and saves a
 * dependency.
 */
export function readFromTgz(tgz: Buffer, name: string): Buffer | null {
    const tar = gunzipSync(tgz);
    let offset = 0;
    while (offset + 512 <= tar.length) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every(b => b === 0)) break;

        const field = (start: number, len: number) =>
                header
                    .subarray(start, start + len)
                    .toString('utf8')
                    .replace(/\0.*$/s, ''),
            prefix = field(345, 155),
            path = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100),
            size = parseInt(field(124, 12).trim() || '0', 8),
            type = field(156, 1);

        offset += 512;
        if ((type === '0' || type === '') && path === name) {
            return Buffer.from(tar.subarray(offset, offset + size));
        }
        offset += Math.ceil(size / 512) * 512;
    }
    return null;
}
