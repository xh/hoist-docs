package io.xh.hoistdocs

import io.xh.hoist.exception.NotFoundException
import io.xh.hoist.security.AccessAll
import io.xh.hoistdocs.index.LibraryIndex

/**
 * API for the docs viewer. Mirrors the Toolbox docs viewer's API (`registry`, `content`), keyed by
 * source names `hoist-react` and `hoist-core`, with an optional version per source.
 */
@AccessAll
class DocsController extends BaseController {

    IndexService indexService

    static final Map<String, String> SOURCE_BY_LIBRARY = [react: 'hoist-react', core: 'hoist-core']
    static final Map<String, String> LABEL_BY_LIBRARY = [react: 'Hoist React', core: 'Hoist Core']

    /** Doc registry of every library at the requested (or newest) version. */
    def registry() {
        List<Map> entries = []
        Map sources = [:]
        indexService.libraryIds.each { String libId ->
            LibraryIndex lib = indexService.getLibrary(libId, params[sourceName(libId)] as String)
            String source = sourceName(libId)
            sources[source] = [
                label     : LABEL_BY_LIBRARY[libId] ?: lib.name,
                categories: lib.viewerCategories,
                version   : lib.version,
                versions  : indexService.getVersions(libId)
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
        String libId = SOURCE_BY_LIBRARY.find { it.value == source }?.key ?: source
        LibraryIndex lib = indexService.getLibrary(libId, params.version as String)
        def entry = lib.docsById[docId]
        if (!entry) throw new NotFoundException("Doc not found: ${source}:${docId}")
        renderJSON(content: entry.markdown)
    }

    private static String sourceName(String libId) {
        SOURCE_BY_LIBRARY[libId] ?: libId
    }
}
