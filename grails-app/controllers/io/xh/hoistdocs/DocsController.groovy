package io.xh.hoistdocs

import io.xh.hoist.config.ConfigService
import io.xh.hoist.exception.NotFoundException
import io.xh.hoist.security.AccessAll
import io.xh.hoist.track.TrackService
import io.xh.hoistdocs.index.LibraryIndex

/**
 * Public, read-only docs API for docs viewers - Toolbox's desktop and mobile viewers in
 * particular. Keyed by source names `hoist-react` and `hoist-core`; each source's version can be
 * chosen with a request param named for the source (e.g. `hoist-react=86.2.0`), defaulting to the
 * newest loaded.
 *
 * These URIs are whitelisted in `AuthenticationService` - docs are public.
 */
@AccessAll
class DocsController extends BaseController {

    IndexService indexService
    TrackService trackService
    ConfigService configService

    static final Map<String, String> SOURCE_BY_LIBRARY = [react: 'hoist-react', core: 'hoist-core']
    static final Map<String, String> LABEL_BY_LIBRARY = [react: 'Hoist React', core: 'Hoist Core']

    /** Doc registry of every library, with each library's categories and available versions. */
    def registry() {
        List<Map> entries = []
        Map sources = [:]
        libraries.each { LibraryIndex lib ->
            String source = sourceName(lib.id)
            sources[source] = [
                label     : LABEL_BY_LIBRARY[lib.id] ?: lib.name,
                categories: lib.viewerCategories,
                version   : lib.version,
                versions  : indexService.getVersions(lib.id)
            ]
            lib.docs.each {
                entries << [id: it.id, source: source, title: it.title, category: it.viewerCategory, description: it.description, keywords: it.keywords]
            }
        }
        renderJSON(entries: entries, sources: sources)
    }

    /** Markdown of one doc. */
    def content() {
        String source = params.source, docId = params.docId
        LibraryIndex lib = indexService.getLibrary(libraryId(source), params[source] as String ?: params.version as String)
        def entry = lib.docsById[docId]
        if (!entry) throw new NotFoundException("Doc not found: ${source}:${docId}")
        renderJSON(content: entry.markdown)
    }

    /**
     * Ranked docs matching a query, across every library - the same ranking the MCP tools use,
     * with each doc listed once under its best-matching section.
     */
    def search() {
        String query = params.query
        int limit = (params.limit ?: 25) as int
        long start = System.currentTimeMillis()

        List<Map> results = libraries.collectMany { LibraryIndex lib ->
            lib.docSearch.searchDocs(query, limit).collect {
                [source: sourceName(lib.id), id: it.entry.id, score: it.score, section: it.section.ref, snippet: it.excerpt]
            }
        }.sort { -(it.score as double) }.take(limit)

        trackSearch(query, results.size(), System.currentTimeMillis() - start)
        renderJSON(results: results)
    }

    //------------------------
    // Implementation
    //------------------------
    /** The newest loaded version of each library, or the version a request param names. */
    private List<LibraryIndex> getLibraries() {
        indexService.libraryIds.collect { indexService.getLibrary(it, params[sourceName(it)] as String) }
    }

    private void trackSearch(String query, int resultCount, long elapsed) {
        Map cfg = configService.getMap('mcpConfig')
        Map data = [resultCount: resultCount, client: params.client ?: request.getHeader('User-Agent')]
        if (cfg.logQueries) data.query = query
        Map entry = [category: 'Docs', msg: 'Searched docs', elapsed: elapsed, data: data]
        if (!authUser) entry.username = params.client ?: (cfg.anonymousUsername ?: 'mcp-anonymous')
        trackService.track(entry)
    }

    private static String sourceName(String libId) {
        SOURCE_BY_LIBRARY[libId] ?: libId
    }

    private static String libraryId(String source) {
        SOURCE_BY_LIBRARY.find { it.value == source }?.key ?: source
    }
}
