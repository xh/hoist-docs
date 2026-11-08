package io.xh.hoistdocs

import io.xh.hoist.BaseService
import io.xh.hoist.exception.DataNotAvailableException
import io.xh.hoistdocs.index.LibraryIndex

import java.util.concurrent.ConcurrentHashMap

import static io.xh.hoist.util.InstanceConfigUtils.getInstanceConfig

/**
 * Loads library index files and serves the version a request asks for.
 *
 * Index files (`<libraryId>-<version>.json[.gz]`, see docs/index-schema.md) are discovered in the
 * directory named by the `indexDir` instance config (default `./indexes`). Each file is parsed on
 * first use and then held in memory; the newest version of each library is loaded at startup.
 */
class IndexService extends BaseService {

    /** Libraries in display order. hoist-react comes first, so its doc ids win when unqualified. */
    static final List<String> LIBRARY_ORDER = ['react', 'core']

    private static final String FILE_PATTERN = /^([a-z][a-z0-9-]*)-(.+?)\.json(\.gz)?$/

    /** libraryId -> version -> file */
    private Map<String, Map<String, File>> files = [:]
    private Map<String, LibraryIndex> loaded = new ConcurrentHashMap<>()

    void init() {
        scan()
        libraryIds.each { getLibrary(it, null) }
        super.init()
    }

    File getIndexDir() {
        new File(getInstanceConfig('indexDir') ?: 'indexes').absoluteFile
    }

    /** Library ids with at least one index file, in display order. */
    List<String> getLibraryIds() {
        files.keySet().sort { a, b ->
            int ia = LIBRARY_ORDER.indexOf(a), ib = LIBRARY_ORDER.indexOf(b)
            (ia < 0 ? 99 : ia) <=> (ib < 0 ? 99 : ib) ?: a <=> b
        }
    }

    /** Available versions of a library, newest first. */
    List<String> getVersions(String libraryId) {
        (files[libraryId]?.keySet() ?: []).sort(false, VERSION_COMPARATOR).reverse()
    }

    /**
     * The index for a library at a version - the newest when version is null. Throws if the
     * library or version has no index file.
     */
    LibraryIndex getLibrary(String libraryId, String version) {
        def byVersion = files[libraryId]
        if (!byVersion) throw new DataNotAvailableException("No index loaded for library '$libraryId'. Available: ${libraryIds.join(', ')}")
        String v = version ?: getVersions(libraryId).first()
        File file = byVersion[v]
        if (!file) throw new DataNotAvailableException("No index for $libraryId version '$v'. Available: ${getVersions(libraryId).join(', ')}")

        String key = "$libraryId@$v"
        def ret = loaded[key]
        if (!ret) {
            synchronized (this) {
                ret = loaded[key]
                if (!ret) {
                    ret = withInfo(['Loading index', file.name]) { LibraryIndex.load(file) }
                    loaded[key] = ret
                }
            }
        }
        return ret
    }

    /** The newest loaded index of every library, in display order. */
    List<LibraryIndex> getLatest() {
        libraryIds.collect { getLibrary(it, null) }
    }

    void clearCaches() {
        loaded.clear()
        scan()
        super.clearCaches()
    }

    //------------------------
    // Implementation
    //------------------------
    private void scan() {
        Map<String, Map<String, File>> ret = [:]
        def dir = indexDir
        if (!dir.isDirectory()) {
            logWarn('Index directory not found - no docs will be served', dir.path)
        } else {
            dir.listFiles().each { File f ->
                def m = f.name =~ FILE_PATTERN
                if (!m.matches()) return
                String lib = m.group(1), version = m.group(2)
                def byVersion = ret.computeIfAbsent(lib) { [:] }
                // Prefer the uncompressed file when both exist.
                if (!byVersion[version] || !f.name.endsWith('.gz')) byVersion[version] = f
            }
        }
        files = ret
        logInfo('Index files found', ret.collectEntries { k, v -> [k, v.keySet().sort(false, VERSION_COMPARATOR)] })
    }

    /** Orders versions numerically by segment; a SNAPSHOT sorts before its release. */
    static final Comparator<String> VERSION_COMPARATOR = { String a, String b ->
        def pa = parseVersion(a), pb = parseVersion(b)
        for (int i = 0; i < Math.max(pa.nums.size(), pb.nums.size()); i++) {
            int c = (pa.nums[i] ?: 0) <=> (pb.nums[i] ?: 0)
            if (c) return c
        }
        if (pa.snapshot != pb.snapshot) return pa.snapshot ? -1 : 1
        return a <=> b
    } as Comparator<String>

    private static Map parseVersion(String v) {
        boolean snapshot = v.toUpperCase().contains('SNAPSHOT')
        def nums = (v.replaceAll(/(?i)-SNAPSHOT.*/, '').split(/[.\-]/) as List<String>).collect {
            it.isInteger() ? it.toInteger() : 0
        }
        return [nums: nums, snapshot: snapshot]
    }

    Map getAdminStats() {
        [
            indexDir : indexDir.path,
            libraries: libraryIds.collectEntries { [it, getVersions(it)] },
            loaded   : loaded.keySet().sort()
        ]
    }
}
