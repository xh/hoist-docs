package io.xh.hoistdocs.index

import groovy.json.JsonSlurper
import groovy.transform.CompileStatic

import java.util.zip.GZIPInputStream

/**
 * One library version's index file, loaded into memory: its docs (with sections), symbols with
 * precomputed detail and members, and the member index. Search indexes over these are built
 * lazily on first use. See docs/index-schema.md for the file format.
 */
@CompileStatic
class LibraryIndex {

    static final int SCHEMA_VERSION = 1

    static class DocEntry {
        String id
        String title
        String mcpCategory
        String viewerCategory
        String description
        List<String> keywords
        List<String> aliases
        String markdown
        private List<DocSections.DocSection> _sections

        List<DocSections.DocSection> getSections() {
            _sections ?= DocSections.parse(id, title, markdown)
        }
    }

    /** Library id used in tool arguments: `react`, `core`, or a companion id. */
    final String id
    /** Package name, e.g. `@xh/hoist`. */
    final String name
    final String version
    final String language
    final String gitSha
    final String builtAt
    final String description

    final List<Map> mcpCategories
    final List<Map> viewerCategories
    final List<DocEntry> docs
    final Map<String, DocEntry> docsById

    /** Symbol maps as stored in the file. */
    final List<Map> symbols
    final List<Map> memberIndex
    /** Symbols keyed by lowercase name, in file order. */
    final Map<String, List<Map>> symbolsByKey

    final DocIdResolver resolver

    private DocSearch _docSearch
    private SymbolSearch _symbolSearch

    LibraryIndex(Map json) {
        int schema = json.schemaVersion as int
        if (schema != SCHEMA_VERSION) {
            throw new IllegalArgumentException("Unsupported index schemaVersion $schema - expected $SCHEMA_VERSION")
        }
        Map lib = json.library as Map
        id = lib.id
        name = lib.name
        version = lib.version
        language = lib.language
        gitSha = lib.gitSha
        builtAt = lib.builtAt
        description = lib.description

        Map docsJson = json.docs as Map
        mcpCategories = (docsJson.mcpCategories ?: []) as List<Map>
        viewerCategories = (docsJson.viewerCategories ?: []) as List<Map>
        docs = (docsJson.entries as List<Map>).collect { Map e ->
            new DocEntry(
                id: e.id, title: e.title, mcpCategory: e.mcpCategory,
                viewerCategory: e.viewerCategory, description: e.description ?: '',
                keywords: (e.keywords ?: []) as List<String>, aliases: (e.aliases ?: []) as List<String>,
                markdown: e.markdown ?: ''
            )
        }
        docsById = docs.collectEntries { [it.id, it] } as Map<String, DocEntry>

        symbols = (json.symbols ?: []) as List<Map>
        memberIndex = (json.memberIndex ?: []) as List<Map>
        symbolsByKey = new LinkedHashMap<>()
        symbols.each { Map s ->
            symbolsByKey.computeIfAbsent((s.name as String).toLowerCase(Locale.ROOT)) { [] } << s
        }
        resolver = new DocIdResolver(docs)
    }

    static LibraryIndex load(File file) {
        InputStream is = new FileInputStream(file)
        try {
            if (file.name.endsWith('.gz')) is = new GZIPInputStream(is)
            Map json = new JsonSlurper().parse(is, 'UTF-8') as Map
            return new LibraryIndex(json)
        } finally {
            is.close()
        }
    }

    boolean isTypeScript() { language == 'typescript' }

    synchronized DocSearch getDocSearch() {
        _docSearch ?= new DocSearch(this)
    }

    synchronized SymbolSearch getSymbolSearch() {
        _symbolSearch ?= new SymbolSearch(this)
    }

    //------------------------
    // Symbol lookup
    //------------------------
    /** Exact-name lookup, optionally narrowed by file and kind. Prefers exported symbols. */
    Map findSymbol(String name, String filePath = null, String kind = null) {
        def entries = symbolsByKey.get(name.toLowerCase(Locale.ROOT))
        if (!entries) return null
        def exact = entries.findAll { it.name == name && (!kind || it.kind == kind) }
        if (!exact) return null
        if (filePath) {
            String rel = normalizePath(filePath)
            return exact.find { it.filePath == rel }
        }
        return exact.find { it.isExported } ?: exact[0]
    }

    /** Every declaration of a name in the file it resolves to, primary first. */
    List<Map> findDeclarations(String name, String filePath = null, String kind = null) {
        def primary = findSymbol(name, filePath, kind)
        if (!primary) return []
        if (kind) return [primary]
        def siblings = (symbolsByKey.get(name.toLowerCase(Locale.ROOT)) ?: []).findAll {
            !it.is(primary) && it.name == name && it.filePath == primary.filePath
        }
        return [primary] + siblings
    }

    /** Other exported symbols with this name, in other files. */
    List<Map> findAlternates(String name, String selectedFilePath) {
        (symbolsByKey.get(name.toLowerCase(Locale.ROOT)) ?: []).findAll {
            it.name == name && it.isExported && it.filePath != selectedFilePath &&
                !(it.sourcePackage as String).startsWith('dynamics')
        }
    }

    /** For a Props interface, its component consts; for a component const, its Props interface. */
    List<Map> findCompanions(Map entry) {
        String name = entry.name as String
        if (entry.kind == 'interface' && name.endsWith('Props')) {
            String base = name[0..-6]
            if (!base) return []
            String camel = base[0].toLowerCase() + base.substring(1)
            return [base, camel].unique().collectMany { String n ->
                (symbolsByKey.get(n.toLowerCase(Locale.ROOT)) ?: []).findAll {
                    it.name == n && it.kind == 'const' && it.filePath == entry.filePath
                }
            }
        }
        if (entry.kind == 'const') {
            String props = name[0].toUpperCase() + name.substring(1) + 'Props'
            return (symbolsByKey.get(props.toLowerCase(Locale.ROOT)) ?: []).findAll {
                it.name == props && it.kind == 'interface' && it.filePath == entry.filePath
            }
        }
        return []
    }

    private static String normalizePath(String p) {
        p.replace('\\', '/').replaceAll(/^\.\//, '').replaceAll(/^\/+/, '')
    }
}
