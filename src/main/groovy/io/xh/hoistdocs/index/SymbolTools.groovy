package io.xh.hoistdocs.index

import static io.xh.hoistdocs.index.DocSections.estimateTokens
import static io.xh.hoistdocs.index.SearchText.firstSentence

/**
 * Symbol tools over one or more loaded libraries: search, describe one symbol, and list members.
 * Output text follows hoist-react's `mcp/formatters/typescript.ts`. Groovy symbols (hoist-core)
 * use the same shapes, with a Java-style import line.
 */
class SymbolTools {

    static final int MAX_SUMMARY_MEMBERS = 60
    static final int MAX_EXTERNAL_LISTED = 40
    static final int FULL_DETAIL_MAX_TOKENS = 5000
    static final int SUMMARY_TYPE_LENGTH = 80
    static final int MAX_TYPE_LENGTH = 200

    static class Output {
        String text
        Map structured
        boolean isError = false
    }

    final List<LibraryIndex> libraries

    SymbolTools(List<LibraryIndex> libraries) {
        this.libraries = libraries
    }

    //------------------------
    // Helpers
    //------------------------
    private static String collapseDoc(String doc) {
        (doc ?: '').split('\n').findAll { it.trim() }.join('\n')
    }

    private static String indentDoc(String doc, String indent = '    ') {
        collapseDoc(doc).split('\n').collect { indent + it }.join('\n')
    }

    static String truncateType(String type, int max = MAX_TYPE_LENGTH) {
        String t = type ?: ''
        t.length() > max ? t.substring(0, max) + '...' : t
    }

    /** Import path and whether it is a package barrel, for a symbol in a library. */
    private static Map resolveImport(LibraryIndex lib, Map e) {
        if (!lib.typeScript) {
            return [importPath: e.sourcePackage ? "${e.sourcePackage}.${e.name}".toString() : null, barrelExport: false]
        }
        if (e.importPath) return [importPath: e.importPath, barrelExport: true]
        if (!e.isExported || e.isPromiseExtension) return [importPath: null, barrelExport: false]
        return [importPath: "@xh/hoist/${(e.filePath as String).replaceAll(/\.tsx?$/, '')}".toString(), barrelExport: false]
    }

    private static String hitImport(LibraryIndex lib, Map imp, String filePath, boolean isPromise) {
        if (imp.importPath) {
            if (!lib.typeScript) return imp.importPath as String
            return imp.barrelExport ? imp.importPath as String : "${imp.importPath}; file import"
        }
        return isPromise ? 'Promise prototype extension, no import needed' : "not exported - ${filePath}"
    }

    private static String importLine(LibraryIndex lib, Map detail) {
        def imp = resolveImport(lib, detail)
        if (!lib.typeScript) return imp.importPath ? "import ${imp.importPath}" : 'none'
        if (imp.importPath) {
            String line = "import {${detail.name}} from '${imp.importPath}';"
            return imp.barrelExport ? line : "${line} (no package barrel re-exports this symbol)"
        }
        if (detail.isPromiseExtension) return 'none needed - Promise prototype extension, available on every Promise'
        return 'none - not exported from its file'
    }

    private static String memberLabel(Map m) {
        "${m.isStatic ? 'static ' : ''}${m.name}${m.isOptional ? '?' : ''}"
    }

    private static String memberSignature(LibraryIndex lib, Map m, int typeLength = MAX_TYPE_LENGTH) {
        String sig
        if (m.kind == 'method') {
            String params = ((m.parameters ?: []) as List<Map>).collect { "${it.name}: ${truncateType(it.type as String, typeLength)}" }.join(', ')
            String ret = m.returnType ?: (lib.typeScript ? 'void' : (m.type ?: 'void'))
            sig = "${memberLabel(m)}(${params}): ${truncateType(ret, typeLength)}"
        } else {
            sig = "${memberLabel(m)}: ${truncateType(m.type as String, typeLength)}"
        }
        return m.default != null ? "${sig} = ${m.default}" : sig
    }

    private static Map symbolRef(LibraryIndex lib, Map e) {
        [name: e.name, kind: e.kind, library: lib.name] + resolveImport(lib, e) +
            [sourcePackage: e.sourcePackage, filePath: e.filePath, exported: e.isExported]
    }

    private static Map symbolDetail(LibraryIndex lib, Map d) {
        Map ret = symbolRef(lib, d) + [signature: d.signature, jsDoc: d.doc ?: '']
        ['extends', 'implements', 'decorators', 'constructorType', 'instanceOf'].each { if (d[it]) ret[it] = d[it] }
        return ret
    }

    private static String alternatesNote(String name, List<Map> alternates) {
        if (!alternates) return ''
        String list = alternates.collect { "  - [${it.kind}] ${it.sourcePackage} (${it.filePath})" }.join('\n')
        return "Note: ${alternates.size() + 1} symbols named \"${name}\" exist. Others, selectable by file path:\n${list}"
    }

    private static String filePathHint(List<Map> alternates) {
        alternates ? " Select an alternate with filePath: \"${alternates[0].filePath}\"." : ''
    }

    //------------------------
    // Search
    //------------------------
    Output search(String query, Map opts = [:]) {
        String detail = opts.detail ?: 'concise'
        int limit = Math.min(Math.max((opts.limit ?: SymbolSearch.DEFAULT_LIMIT) as int, 1), SymbolSearch.MAX_LIMIT)
        List<Map> perLib = libraries.collect { LibraryIndex lib -> [lib: lib, res: lib.symbolSearch.search(query, opts + [limit: limit])] }

        List<Map> symbols = perLib.collectMany { Map p -> (p.res as SymbolSearch.Results).symbols.collect { [lib: p.lib, hit: it] } }
            .sort(false) { Map a, Map b -> Double.compare((b.hit as SymbolSearch.SymbolHit).score, (a.hit as SymbolSearch.SymbolHit).score) }
            .take(limit)
        List<Map> members = perLib.collectMany { Map p -> (p.res as SymbolSearch.Results).members.collect { [lib: p.lib, hit: it] } }
            .sort(false) { Map a, Map b -> Double.compare((b.hit as SymbolSearch.MemberHit).score, (a.hit as SymbolSearch.MemberHit).score) }
            .take(limit)
        int symbolTotal = perLib.sum { (it.res as SymbolSearch.Results).symbolTotal } as int,
            memberTotal = perLib.sum { (it.res as SymbolSearch.Results).memberTotal } as int,
            hiddenSymbols = perLib.sum { (it.res as SymbolSearch.Results).hiddenSymbols } as int,
            hiddenMembers = perLib.sum { (it.res as SymbolSearch.Results).hiddenMembers } as int
        List<Map> hiddenExact = perLib.collectMany { Map p -> (p.res as SymbolSearch.Results).hiddenExact.collect { [lib: p.lib, entry: it] } }

        List<String> lines = []
        if (!symbols && !members) {
            lines << "No symbols or members matched \"${query}\". Try one strong keyword - an API name like \"GridModel\" or \"persistWith\" (camelCase names match their parts).".toString()
        }
        if (symbols) {
            lines << "Symbols (${symbols.size()} of ${symbolTotal} matched \"${query}\"):".toString()
            symbols.eachWithIndex { Map it, int i ->
                LibraryIndex lib = it.lib as LibraryIndex
                def hit = it.hit as SymbolSearch.SymbolHit
                Map e = hit.entry
                String kind = hit.factory || hit.props ? 'component' : e.kind,
                       name = hit.factory ? "${e.name} / ${hit.factory}" : e.name,
                       where = hitImport(lib, resolveImport(lib, e), e.filePath as String, e.isPromiseExtension == true),
                       props = hit.props ? " Props: ${hit.props}." : '',
                       hint = e.hint ? " [${e.hint}]" : ''
                if (detail == 'full') {
                    lines << "${i + 1}. [${kind}] ${name} (${where}; file: ${e.filePath}; exported: ${e.isExported ? 'yes' : 'no'})${props}${hint}".toString()
                    if (e.doc) lines << indentDoc(e.doc as String)
                } else {
                    String summary = hit.summary ? " - ${hit.summary}" : ''
                    lines << "${i + 1}. [${kind}] ${name} (${where})${summary}${props}${hint}".toString()
                }
            }
        }
        if (members) {
            if (lines) lines << ''
            lines << "Members (${members.size()} of ${memberTotal}):".toString()
            Set<String> hintedOwners = [] as Set
            members.eachWithIndex { Map it, int i ->
                LibraryIndex lib = it.lib as LibraryIndex
                def hit = it.hit as SymbolSearch.MemberHit
                Map m = hit.entry
                String label = "${m.isStatic ? 'static ' : ''}${m.ownerName}.${m.name}",
                       dflt = m.default != null ? " = ${m.default}" : '',
                       ownerHint = m.ownerHint && !hintedOwners.contains(m.ownerName) ? " [${m.ownerName}: ${m.ownerHint}]" : ''
                hintedOwners << (m.ownerName as String)
                if (detail == 'full') {
                    def imp = m.ownerName == 'Promise' ? [importPath: null] :
                        resolveImport(lib, [name: m.ownerName, filePath: m.filePath, importPath: hit.importPath, isExported: true, sourcePackage: m.sourcePackage])
                    lines << "${i + 1}. [${m.memberKind}] ${label}: ${truncateType(m.type as String)}${dflt} (${hitImport(lib, imp, m.filePath as String, m.ownerName == 'Promise')})${ownerHint}".toString()
                    if (m.doc) lines << indentDoc(m.doc as String)
                } else {
                    String summary = hit.summary ? " - ${hit.summary}" : ''
                    lines << "${i + 1}. ${label}: ${truncateType(m.type as String, SUMMARY_TYPE_LENGTH)}${dflt}${summary}${ownerHint}".toString()
                }
            }
        }

        lines << ''
        lines << (symbols || members ?
            'Next: hoist-get-symbol {name} for signature, docs, and a member summary; hoist-get-members {name, filter} for member docs.' :
            'For concepts and how-tos use hoist-search-docs.')
        hiddenExact.each { Map h ->
            LibraryIndex lib = h.lib as LibraryIndex
            Map e = h.entry as Map
            lines << "Hidden exact match: ${e.name} (${e.filePath}) - internal (${lib.symbolSearch.internalDir(e.filePath as String)}/) code; pass includeInternal: true to see it.".toString()
        }
        if (hiddenSymbols + hiddenMembers > 0) {
            lines << "Hidden: ${plural(hiddenSymbols, 'internal symbol')}, ${plural(hiddenMembers, 'member')} (includeInternal: true shows them).".toString()
        }

        return new Output(text: lines.join('\n'), structured: [
            query        : query,
            detail       : detail,
            symbolCount  : symbols.size(),
            symbolTotal  : symbolTotal,
            memberCount  : members.size(),
            memberTotal  : memberTotal,
            hiddenSymbols: hiddenSymbols,
            hiddenMembers: hiddenMembers,
            hiddenExact  : hiddenExact.collect { [name: it.entry.name, kind: it.entry.kind, filePath: it.entry.filePath] },
            symbols      : symbols.collect { Map it ->
                def hit = it.hit as SymbolSearch.SymbolHit
                Map ret = symbolRef(it.lib as LibraryIndex, hit.entry) + [summary: hit.summary, hasMembers: hit.hasMembers]
                if (hit.factory) ret.factory = hit.factory
                if (hit.props) ret.props = hit.props
                if (hit.entry.hint) ret.hint = hit.entry.hint
                if (detail == 'full') ret.jsDoc = hit.entry.doc
                ret
            },
            members      : members.collect { Map it ->
                def hit = it.hit as SymbolSearch.MemberHit
                Map m = hit.entry
                Map ret = [name: m.name, memberKind: m.memberKind, ownerName: m.ownerName, library: (it.lib as LibraryIndex).name,
                           sourcePackage: m.sourcePackage, filePath: m.filePath, isStatic: m.isStatic, type: m.type,
                           summary: hit.summary, decorators: m.decorators ?: []]
                if (m.ownerHint) ret.ownerHint = m.ownerHint
                if (m.default != null) ret.default = m.default
                if (detail == 'full') ret.jsDoc = m.doc
                ret
            }
        ])
    }

    private static String plural(int n, String word) {
        "${n} ${word}${n == 1 ? '' : 's'}"
    }

    //------------------------
    // Locate
    //------------------------
    /** First library whose index has the name, as [lib, declarations]. */
    private Map locate(String name, String filePath, String kind) {
        for (LibraryIndex lib : libraries) {
            def decls = lib.findDeclarations(name, filePath, kind)
            if (decls) return [lib: lib, decls: decls]
        }
        return null
    }

    //------------------------
    // Get symbol
    //------------------------
    Output describe(String name, String filePath = null, String kind = null) {
        def found = locate(name, filePath, kind)
        if (!found) return new Output(text: "Symbol \"${name}\" not found. Use hoist-search-symbols to find the exact name.", isError: true)

        LibraryIndex lib = found.lib as LibraryIndex
        List<Map> decls = found.decls as List<Map>
        Map primary = decls[0]
        List<Map> others = decls.drop(1)
        List<Map> companions = lib.findCompanions(primary)
        List<Map> alternates = filePath ? [] : lib.findAlternates(name, primary.filePath as String)
        List<Map> members = primary.members as List<Map>

        List<String> lines = []
        if (others) {
            lines << "${decls.size()} declarations of \"${name}\" in ${primary.filePath}: ${decls.collect { it.kind }.join(' and ')}.".toString()
            lines << ''
        }
        lines << formatSymbolBlock(lib, primary, companions)
        others.each { lines << ''; lines << '---'; lines << ''; lines << formatSymbolBlock(lib, it, []) }
        if (members != null) { lines << ''; lines << formatMemberSummary(lib, members) }
        if (alternates) { lines << ''; lines << alternatesNote(name, alternates) }

        String hint = (symbolNextHint(primary, companions) + filePathHint(alternates)).trim()
        Map structured = [
            requestedName    : name,
            symbol           : symbolDetail(lib, primary),
            otherDeclarations: others.collect { symbolDetail(lib, it) },
            companions       : companions.collect { symbolRef(lib, it) },
            alternates       : alternates.collect { symbolRef(lib, it) }
        ]
        if (members != null) {
            structured.members = [
                total: members.size(),
                shown: Math.min(members.size(), MAX_SUMMARY_MEMBERS),
                list : members.take(MAX_SUMMARY_MEMBERS).collect { Map m ->
                    Map r = [name: m.name, kind: m.kind, signature: memberSignature(lib, m, SUMMARY_TYPE_LENGTH), isStatic: m.isStatic]
                    if (m.inheritedFrom) r.inheritedFrom = m.inheritedFrom
                    r
                }
            ]
        }
        return new Output(text: hint ? "${lines.join('\n')}\n\n${hint}" : lines.join('\n'), structured: structured)
    }

    private static String formatSymbolBlock(LibraryIndex lib, Map d, List<Map> companions) {
        List<String> lines = [
            "# ${d.name} (${d.kind})".toString(),
            "Import: ${importLine(lib, d)}".toString(),
            "Package: ${d.sourcePackage}".toString(),
            "File: ${d.filePath}".toString(),
            "Exported: ${d.isExported ? 'yes' : 'no'}".toString()
        ]
        if (d.extends) lines << "Extends: ${d.extends}".toString()
        if (d.implements) lines << "Implements: ${(d.implements as List).join(', ')}".toString()
        if (d.decorators) lines << "${lib.typeScript ? 'Decorators' : 'Annotations'}: ${(d.decorators as List).collect { "@${it}" }.join(', ')}".toString()
        if (d.constructorType) lines << "Constructor: new ${d.name}(config: ${d.constructorType})".toString()
        if (d.instanceOf) lines << "Instance of: ${d.instanceOf}".toString()
        if (companions) {
            if (d.kind == 'interface' && (d.name as String).endsWith('Props')) {
                lines << "Component: ${companions.collect { it.name }.join(', ')}".toString()
            } else {
                lines << "Props: ${companions[0].name}".toString()
            }
        }
        lines << ''
        lines << '## Signature'
        lines << (d.signature as String)
        if (d.doc) { lines << ''; lines << '## Documentation'; lines << collapseDoc(d.doc as String) }
        return lines.join('\n')
    }

    private static String formatMemberSummary(LibraryIndex lib, List<Map> members) {
        def own = members.findAll { !it.inheritedFrom }, inherited = members.findAll { it.inheritedFrom }
        def shown = members.take(MAX_SUMMARY_MEMBERS)
        List<String> lines = ["## Members (${own.size()} own, ${inherited.size()} inherited)".toString()]
        String lastSource = null
        shown.each { Map m ->
            if (m.inheritedFrom && m.inheritedFrom != lastSource) {
                lines << "### Inherited from ${m.inheritedFrom}".toString()
                lastSource = m.inheritedFrom
            }
            lines << "- ${memberSignature(lib, m, SUMMARY_TYPE_LENGTH)}".toString()
        }
        if (members.size() > shown.size()) lines << "(${members.size() - shown.size()} more members not shown)".toString()
        if (!members) lines << 'No members found.'
        return lines.join('\n')
    }

    private static String symbolNextHint(Map d, List<Map> companions) {
        String target = d.kind in ['class', 'interface', 'trait'] ? d.name :
            (d.instanceOf ?: companions.find { it.kind == 'interface' }?.name)
        if (!target) return ''
        String what = target == d.name ? 'Full member details' :
            target == d.instanceOf ? "Members of `${target}`" : "Its props (`${target}`)"
        return "${what}: hoist-get-members {name: \"${target}\"}; narrow with filter: \"<text>\", include: \"own\" | \"inherited\", or memberKind."
    }

    //------------------------
    // Get members
    //------------------------
    Output members(Map args) {
        String name = args.name as String, filePath = args.filePath as String
        String filter = args.filter ?: null, include = args.include ?: 'all', memberKind = args.memberKind ?: null

        LibraryIndex lib = null
        Map symbol = null
        for (LibraryIndex l : libraries) {
            symbol = l.findSymbol(name, filePath, 'class') ?: l.findSymbol(name, filePath, 'interface') ?:
                l.findSymbol(name, filePath, 'trait') ?: l.findSymbol(name, filePath)
            if (symbol) { lib = l; break }
        }
        if (!symbol) return new Output(text: "Symbol \"${name}\" not found. Use hoist-search-symbols to find the exact name.", isError: true)
        if (symbol.members == null) {
            def entries = lib.findDeclarations(name, symbol.filePath as String)
            return new Output(isError: true, text:
                "\"${name}\" is a ${entries.collect { it.kind }.join(' and ')} (${symbol.filePath}), not a class or interface, so it has no members to list. Use hoist-get-symbol {name: \"${name}\"} to see its declaration.")
        }

        List<Map> all = symbol.members as List<Map>
        String needle = filter?.toLowerCase(Locale.ROOT)
        List<Map> members = all.findAll { Map m ->
            (!needle || (m.name as String).toLowerCase(Locale.ROOT).contains(needle)) &&
                (!memberKind || m.kind == memberKind) &&
                (include == 'all' || (include == 'own') == (m.inheritedFrom == null))
        }
        List<Map> allExternal = (symbol.externalMembers ?: []) as List<Map>
        int totalExternal = allExternal.sum(0) { (it.members as List).size() } as int
        String extKind = memberKind == 'accessor' ? 'property' : memberKind
        List<Map> external = include == 'own' ? [] : allExternal.collect { Map g ->
            g + [members: (g.members as List<Map>).findAll { Map m ->
                (!needle || (m.name as String).toLowerCase(Locale.ROOT).contains(needle)) && (!extKind || m.kind == extKind)
            }]
        }.findAll { (it.members as List) }
        List<Map> alternates = filePath ? [] : lib.findAlternates(name, symbol.filePath as String)

        boolean filtering = filter || include != 'all' || memberKind
        String describeFilter = [
            filter ? "matching \"${filter}\"" : '',
            include != 'all' ? "${include} only" : '',
            memberKind ? "${memberKind == 'property' ? 'properties' : memberKind + 's'} only" : ''
        ].findAll { it }.join(', ')
        int externalCount = external.sum(0) { (it.members as List).size() } as int
        String header = filtering ?
            "# ${symbol.name} Members ${describeFilter} (${members.size()} of ${all.size()}${totalExternal ? ", ${externalCount} of ${totalExternal} external" : ''})" :
            "# ${symbol.name} Members (${members.size()}${totalExternal ? ", plus ${totalExternal} external" : ''})"
        List<String> headerLines = [header, "Import: ${importLine(lib, symbol)}".toString()]
        def own = members.findAll { !it.inheritedFrom }, inherited = members.findAll { it.inheritedFrom }
        List<Map> listed = external.collect { Map g ->
            boolean generic = g.module == '@types/react' && !filter
            [declaredIn: g.declaredIn, module: g.module, total: (g.members as List).size(),
             members: generic ? [] : (g.members as List).take(MAX_EXTERNAL_LISTED)]
        }

        Closure<List<String>> renderBody = { String level ->
            List<String> out = []
            formatMembersByCategory(lib, own, out, level)
            Map<String, List<Map>> bySource = new LinkedHashMap<>()
            inherited.each { bySource.computeIfAbsent(it.inheritedFrom as String) { [] } << it }
            bySource.each { String source, List<Map> ms ->
                out << "## Inherited from ${source} (${ms.size()})".toString()
                out << ''
                formatMembersByCategory(lib, ms, out, level)
            }
            if (!members) { out << (filtering ? 'No members match.' : 'No members found.'); out << '' }
            if (external) {
                out << '## Inherited from types outside hoist-react'
                out << ''
                listed.each { Map g ->
                    String from = g.module ? "${g.declaredIn} (${g.module})" : g.declaredIn
                    if (!(g.members as List)) {
                        out << "### ${from} - ${g.total} standard React attributes, not listed".toString()
                    } else {
                        out << "### ${from} (${g.total})".toString()
                        (g.members as List<Map>).each { out << "- ${it.name}${it.type ? ": ${it.type}" : ''}".toString() }
                        if ((g.members as List).size() < (g.total as int)) out << "(${(g.total as int) - (g.members as List).size()} more not listed)".toString()
                    }
                    out << ''
                }
            }
            if (alternates) { out << alternatesNote(name, alternates); out << '' }
            return out
        }

        String detail = args.detail ?: 'full'
        List<String> body = renderBody(detail)
        String note = null
        if (!args.detail && !filtering && detail == 'full') {
            int fullTokens = estimateTokens((headerLines + [''] + body).join('\n'))
            if (fullTokens > FULL_DETAIL_MAX_TOKENS) {
                detail = 'summary'
                body = renderBody(detail)
                note = "(one line per member: the full listing is ~${String.format(Locale.US, '%,d', fullTokens)} tokens. Narrow it with a filter, or ask for full detail to get complete JSDoc.)"
            }
        } else if (detail == 'summary' && members) {
            note = '(one line per member, as requested; full detail gives complete JSDoc)'
        }

        List<String> lines = headerLines + (note ? [note] : []) + [''] + body
        String hint = "Narrow ${symbol.name} with filter (substring), include: \"own\" | \"inherited\", or memberKind; detail: \"full\" forces docs on a long list. A filter also searches external groups marked \"not listed\".${filePathHint(alternates)}"

        return new Output(text: "${lines.join('\n').replaceAll(/\s+$/, '')}\n\n${hint}", structured: [
            requestedName  : name,
            owner          : symbolDetail(lib, symbol),
            filter         : [include: include] + (filter ? [filter: filter] : [:]) + (memberKind ? [memberKind: memberKind] : [:]),
            detail         : detail,
            totalMembers   : all.size(),
            members        : members.collect { memberJson(it) },
            totalExternal  : totalExternal,
            externalMembers: listed,
            alternates     : alternates.collect { symbolRef(lib, it) }
        ])
    }

    private static Map memberJson(Map m) {
        Map ret = [name: m.name, kind: m.kind, type: m.type, isStatic: m.isStatic, decorators: m.decorators ?: [], jsDoc: m.doc ?: '']
        ['isOptional', 'default', 'parameters', 'returnType', 'returns', 'inheritedFrom'].each { if (m[it] != null) ret[it] = m[it] }
        if (m.docInheritedFrom) ret.jsDocInheritedFrom = m.docInheritedFrom
        return ret
    }

    static String formatMember(LibraryIndex lib, Map m, String detail = 'full') {
        List<String> decorators = (m.decorators ?: []) as List<String>
        String prefix = decorators ? decorators.collect { "@${it}" }.join(' ') + ' ' : '',
               inheritedSuffix = m.inheritedFrom ? "  (inherited from ${m.inheritedFrom})" : ''
        if (detail == 'summary') {
            String summary = firstSentence(m.doc as String, SymbolSearch.MEMBER_SUMMARY_CHARS)
            return "- ${prefix}${memberSignature(lib, m, SUMMARY_TYPE_LENGTH)}${summary ? " - ${summary}" : ''}${inheritedSuffix}"
        }
        List<String> lines = ["- ${prefix}${memberSignature(lib, m)}${inheritedSuffix}".toString()]
        if (m.doc) lines << indentDoc(m.doc as String)
        def described = ((m.parameters ?: []) as List<Map>).findAll { it.description }
        if (described) {
            lines << '    Parameters:'
            described.each { lines << "      ${it.name}: ${(it.description as String).split('\n').join('\n        ')}".toString() }
        }
        if ((m.returns as Map)?.description) {
            lines << "    Returns: ${((m.returns as Map).description as String).split('\n').join('\n      ')}".toString()
        }
        return lines.join('\n')
    }

    private static void formatMembersByCategory(LibraryIndex lib, List<Map> members, List<String> lines, String detail) {
        [
            ['Properties', members.findAll { !it.isStatic && it.kind != 'method' }],
            ['Methods', members.findAll { !it.isStatic && it.kind == 'method' }],
            ['Static Properties', members.findAll { it.isStatic && it.kind != 'method' }],
            ['Static Methods', members.findAll { it.isStatic && it.kind == 'method' }]
        ].each { List g ->
            List<Map> group = g[1] as List<Map>
            if (!group) return
            lines << "### ${g[0]} (${group.size()})".toString()
            group.each { lines << formatMember(lib, it, detail) }
            lines << ''
        }
    }
}
