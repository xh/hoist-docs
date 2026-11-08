package io.xh.hoistdocs.index

import io.xh.hoistdocs.index.DocSections.DocSection

import static io.xh.hoistdocs.index.DocSections.estimateTokens
import static io.xh.hoistdocs.index.DocSections.formatTokens

/**
 * Documentation tools over one or more loaded libraries: search, list, and read. Output text
 * follows hoist-react's `mcp/formatters/docs.ts` so agents see the same shapes as before.
 *
 * Doc ids from libraries other than hoist-react are qualified with the library id
 * (`core:docs/caching.md`), since hoist-react and hoist-core both have e.g. `docs/README.md`.
 * Unqualified ids resolve against hoist-react first.
 */
class DocTools {

    /** Full reads above this size carry a note pointing to `section` and `outline`. */
    static final int LARGE_DOC_TOKENS = 3000

    static class Output {
        String text
        Map structured
        boolean isError = false
    }

    /** Libraries in scope for this call, hoist-react first. */
    final List<LibraryIndex> libraries

    DocTools(List<LibraryIndex> libraries) {
        this.libraries = libraries
    }

    static String qualifiedId(LibraryIndex lib, String docId) {
        lib.id == 'react' ? docId : "${lib.id}:${docId}"
    }

    //------------------------
    // Search
    //------------------------
    Output search(String query, String category = null, Integer limit = null) {
        int max = Math.min(Math.max(limit ?: DocSearch.DEFAULT_LIMIT, 1), DocSearch.MAX_LIMIT)
        List<Map> results = libraries.collectMany { LibraryIndex lib ->
            lib.docSearch.search(query, category, max).collect { [lib: lib, r: it] }
        }.sort(false) { Map a, Map b -> Double.compare((b.r as DocSearch.Result).score, (a.r as DocSearch.Result).score) }
            .take(max)

        String text
        if (!results) {
            text = "No sections matched \"${query}\". Try two or three keywords, using the names the docs use (e.g. \"persistWith\", \"XH.confirm\")."
        } else {
            List<String> lines = ["${results.size()} section${results.size() > 1 ? 's' : ''} matched \"${query}\":".toString(), '']
            results.eachWithIndex { Map it, int i ->
                LibraryIndex lib = it.lib as LibraryIndex
                DocSearch.Result r = it.r as DocSearch.Result
                DocSection s = r.section
                lines << "${i + 1}. ${s.breadcrumb}${libraryLabel(lib)}".toString()
                lines << "   id: ${qualifiedId(lib, r.entry.id)} | section: \"${s.ref}\" | L${s.startLine}-${s.extentEndLine} | ${formatTokens(s.tokens)}".toString()
                lines << "   ${r.excerpt}".toString()
                lines << ''
            }
            text = lines.join('\n').replaceAll(/\s+$/, '') +
                "\n\nRead a result with hoist-read-doc {id, section}, or list a doc's sections with {id, outline: true}."
        }

        return new Output(text: text, structured: [
            query      : query,
            resultCount: results.size(),
            results    : results.collect { Map it ->
                LibraryIndex lib = it.lib as LibraryIndex
                DocSearch.Result r = it.r as DocSearch.Result
                [
                    id        : qualifiedId(lib, r.entry.id),
                    library   : lib.name,
                    section   : r.section.ref,
                    breadcrumb: r.section.breadcrumb,
                    category  : r.entry.mcpCategory,
                    startLine : r.section.startLine,
                    endLine   : r.section.extentEndLine,
                    tokens    : r.section.tokens,
                    score     : Math.round(r.score * 10) / 10d,
                    excerpt   : r.excerpt
                ]
            }
        ])
    }

    /** Tags hits from libraries other than hoist-react when several are in scope. */
    private String libraryLabel(LibraryIndex lib) {
        libraries.size() > 1 && lib.id != 'react' ? " [${lib.name}]" : ''
    }

    //------------------------
    // List
    //------------------------
    Output list(String category = null) {
        String cat = category ?: 'all'
        List<String> lines = []
        List<Map> structuredEntries = []
        libraries.each { LibraryIndex lib ->
            def entries = lib.docs.findAll { cat == 'all' || it.mcpCategory == cat }
            String header = lib.id == 'react' ? 'Hoist Documentation' : "${lib.name} ${lib.version}"
            lines << "${header} (${entries.size()} documents):\n".toString()
            lib.mcpCategories.each { Map c ->
                def inCat = entries.findAll { it.mcpCategory == c.id }
                if (!inCat) return
                lines << "## ${c.title} (${inCat.size()} doc${inCat.size() > 1 ? 's' : ''})".toString()
                inCat.each { lines << "- ${qualifiedId(lib, it.id)}: ${it.description}".toString() }
                lines << ''
            }
            entries.each {
                structuredEntries << [id: qualifiedId(lib, it.id), title: it.title, library: lib.name, category: it.mcpCategory, description: it.description]
            }
        }
        String text = lines.join('\n') +
            'Read a doc with hoist-read-doc {id} - add section: "<heading>" for one section, or outline: true for its headings. The hoist://docs/{id} resource also serves full docs.'

        return new Output(text: text, structured: [
            categoryFilter: cat,
            totalCount    : structuredEntries.size(),
            entries       : structuredEntries,
            categories    : libraries.collectMany { it.mcpCategories }.unique { it.id }.collect { [id: it.id, title: it.title] },
            libraries     : libraries.collect { [name: it.name, version: it.version, docCount: it.docs.size()] }
        ])
    }

    //------------------------
    // Read
    //------------------------
    static class Located {
        LibraryIndex lib
        DocIdResolver.Resolution resolution
    }

    /** Resolve an id - qualified (`core:...`) or not - against the libraries in scope. */
    Located locate(String id) {
        String raw = (id ?: '').trim()
        int colon = raw.indexOf(':')
        if (colon > 0) {
            def lib = libraries.find { it.id == raw.substring(0, colon) }
            if (lib) return new Located(lib: lib, resolution: lib.resolver.resolve(raw.substring(colon + 1)))
        }
        Located firstMiss = null
        for (LibraryIndex lib : libraries) {
            def res = lib.resolver.resolve(raw)
            if (res.kind != 'unknown') return new Located(lib: lib, resolution: res)
            if (!firstMiss) firstMiss = new Located(lib: lib, resolution: res)
        }
        return firstMiss
    }

    Output read(String id, String section = null, boolean outline = false) {
        def located = locate(id)
        if (!located || located.resolution.kind == 'unknown') {
            def suggestions = located?.resolution?.suggestions?.collect { qualifiedId(located.lib, it) } ?: []
            String tail = suggestions ?
                "Did you mean one of: ${suggestions.collect { "\"${it}\"" }.join(', ')}?" :
                'Call hoist-list-docs to see valid IDs, or hoist-search-docs to find one by keyword.'
            return new Output(text: "Unknown document ID: \"${id}\". ${tail}", isError: true)
        }

        LibraryIndex lib = located.lib
        def entry = located.resolution.entry
        String content = entry.markdown,
               canonical = qualifiedId(lib, entry.id)
        Map base = [id: canonical, title: entry.title, category: entry.mcpCategory, library: lib.name]
        if (canonical != id) base.matchedAs = id

        if (!section && !outline) {
            int tokens = estimateTokens(content)
            String note = tokens > LARGE_DOC_TOKENS ?
                "This doc is ${formatTokens(tokens)}. Pass outline: true to list its sections, or section: \"<heading>\" to read one.\n\n" : ''
            return new Output(text: note + content, structured: base + [tokens: tokens, content: content])
        }

        List<DocSection> sections = entry.sections
        DocSection target = null
        if (section) {
            def found = DocSections.resolve(entry.title, sections, section)
            if (found.kind != 'found') {
                return new Output(text: formatSectionMiss(canonical, sections, section, found), isError: true)
            }
            target = found.section
        }

        if (outline) {
            def outlined = target ? DocSections.getSubsections(sections, target) : sections
            List<String> lines = ["Outline of ${canonical} (${entry.title}, ${formatTokens(estimateTokens(content))}, ${DocSections.splitLines(content).size()} lines):".toString(), '']
            outlined.each { DocSection s ->
                lines << "${s.level == 3 ? '  ' : ''}- ${s.heading}  L${s.startLine}-${s.extentEndLine}  ${formatTokens(s.tokens)}".toString()
            }
            lines << ''
            lines << 'Read one with section: "<heading>". Use "<parent> > <heading>" when a heading repeats.'
            return new Output(text: lines.join('\n'), structured: base + [
                tokens : target ? target.tokens : estimateTokens(content),
                outline: outlined.collect { [section: it.ref, heading: it.heading, level: it.level, startLine: it.startLine, endLine: it.extentEndLine, tokens: it.tokens] }
            ])
        }

        String body = DocSections.getSectionContent(content, target)
        return new Output(
            text: "[${canonical} | ${target.breadcrumb} | L${target.startLine}-${target.extentEndLine} | ${formatTokens(target.tokens)}]\n\n${body}",
            structured: base + [
                tokens : target.tokens,
                content: body,
                section: [section: target.ref, breadcrumb: target.breadcrumb, startLine: target.startLine, endLine: target.extentEndLine]
            ]
        )
    }

    private static String formatSectionMiss(String docId, List<DocSection> sections, String input, DocSections.Resolution result) {
        List<String> lines = []
        if (result.kind == 'ambiguous') {
            lines << "Section \"${input}\" matches ${result.candidates.size()} sections in ${docId}. Pass the full path of one:".toString()
            result.candidates.each { lines << "- \"${it.ref}\"".toString() }
        } else {
            lines << "No section \"${input}\" in ${docId}.".toString()
            if (result.suggestions) {
                lines << "Did you mean one of: ${result.suggestions.collect { "\"${it.ref}\"" }.join(', ')}?".toString()
            }
            lines << ''
            lines << 'Sections:'
            sections.each { lines << "${it.level == 3 ? '  ' : ''}- ${it.heading}".toString() }
        }
        return lines.join('\n')
    }
}
