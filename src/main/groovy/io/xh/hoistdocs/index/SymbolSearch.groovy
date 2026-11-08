package io.xh.hoistdocs.index

import groovy.transform.CompileStatic

/**
 * Ranked search over one library's symbols and members. Ported from hoist-react's
 * `mcp/data/symbol-search.ts`, keeping its tuning: field boosts, exact-name and owner boosts,
 * import-path weights, compound-match guard, component / factory / Props merging, and hiding of
 * internal (impl/, admin/, inspector/, dynamics/) code by default.
 */
@CompileStatic
class SymbolSearch {

    static final int DEFAULT_LIMIT = 8, MAX_LIMIT = 20
    static final int SUMMARY_CHARS = 160, MEMBER_SUMMARY_CHARS = 160

    static final Map<String, Double> SYMBOL_BOOST = [name: 4d, kind: 0.3d, package: 0.5d, members: 1d, summary: 1.5d, body: 0.4d]
    static final Map<String, Double> MEMBER_BOOST = [owner: 2d, name: 4d, type: 0.3d, summary: 1.5d, body: 0.4d]
    static final double EXACT_NAME_BOOST = 2.5d, OWNER_NAMED_BOOST = 1.3d
    static final double KIT_WEIGHT = 0.5d, FILE_IMPORT_WEIGHT = 0.125d, INHERITED_DOC_WEIGHT = 0.98d

    static final Set<String> INTERNAL_TOP_DIRS = ['admin', 'inspector', 'dynamics'] as Set<String>
    static final String INTERNAL_SEGMENT = 'impl'

    static class SymbolHit {
        Map entry
        double score
        String summary
        boolean hasMembers
        String factory
        String props
    }

    static class MemberHit {
        Map entry
        double score
        String summary
        String importPath
    }

    static class Results {
        String query
        List<SymbolHit> symbols = []
        List<MemberHit> members = []
        int symbolTotal, memberTotal, hiddenSymbols, hiddenMembers
        List<Map> hiddenExact = []
    }

    final LibraryIndex library
    private final MiniSearch symbolIndex, memberIndex
    private final Map<String, String> symbolHeads, memberHeads
    private final Map<String, String> ownerImportPaths = [:]

    SymbolSearch(LibraryIndex library) {
        this.library = library
        MiniSearch.Tokenizer tokenizer = { String text -> SearchText.tokenize(text) } as MiniSearch.Tokenizer

        def symbolProcessor = new SearchText.CompoundTermProcessor()
        symbolHeads = symbolProcessor.compoundHeads
        symbolIndex = new MiniSearch(['name', 'kind', 'package', 'members', 'summary', 'body'], tokenizer, symbolProcessor)
        library.symbols.each { Map s ->
            def sum = SearchText.splitSummary(s.doc as String)
            symbolIndex.add([s.name, s.kind, s.sourcePackage ?: '', s.memberNames ?: '', sum.summary, sum.rest] as List<String>)
            ownerImportPaths.put("${s.name}|${s.filePath}".toString(), s.importPath as String)
        }

        def memberProcessor = new SearchText.CompoundTermProcessor()
        memberHeads = memberProcessor.compoundHeads
        memberIndex = new MiniSearch(['owner', 'name', 'type', 'summary', 'body'], tokenizer, memberProcessor)
        library.memberIndex.each { Map m ->
            def sum = SearchText.splitSummary(m.doc as String)
            memberIndex.add([m.ownerName, m.name, m.type ?: '', sum.summary, sum.rest] as List<String>)
        }
    }

    Results search(String query, Map opts = [:]) {
        List<String> terms = SearchText.queryTerms(query)
        def ret = new Results(query: query)
        if (!terms) return ret

        int limit = Math.min(Math.max((opts.limit ?: DEFAULT_LIMIT) as int, 1), MAX_LIMIT)
        boolean includeInternal = opts.includeInternal == true
        boolean exportedOnly = opts.exported != null ? opts.exported as boolean : !includeInternal
        String kind = opts.kind as String
        Set<String> querySet = terms as Set<String>
        List<String> rawTokens = SearchText.tokenize(query)
        Set<String> named = (rawTokens.collect { it.toLowerCase(Locale.ROOT) } + [rawTokens.join('').toLowerCase(Locale.ROOT)]) as Set<String>

        //------------------------
        // Symbols
        //------------------------
        def symbolOpts = baseOptions(symbolHeads, terms, querySet)
        symbolOpts.boost = SYMBOL_BOOST
        symbolOpts.filter = { int id ->
            Map e = library.symbols[id]
            (!kind || e.kind == kind) && (!exportedOnly || e.isExported)
        } as MiniSearch.Filter

        List<Map> allSymbolHits = SearchText.rankByCoverage(symbolIndex.search(terms, symbolOpts), terms.size()).collect { SearchText.Ranked r ->
            Map entry = library.symbols[r.hit.id]
            boolean exact = named.contains((entry.name as String).toLowerCase(Locale.ROOT))
            double weight = symbolWeight(entry.importPath as String, entry.isPromiseExtension == true)
            [entry: entry, score: exact ? r.hit.score * EXACT_NAME_BOOST * weight : r.score * weight] as Map
        }
        List<Map> symbolHits = includeInternal ? allSymbolHits : allSymbolHits.findAll { !isInternal(it.entry as Map) }
        if (!includeInternal) {
            ret.hiddenExact = allSymbolHits.findAll { Map h ->
                Map e = h.entry as Map
                isInternal(e) && named.contains((e.name as String).toLowerCase(Locale.ROOT))
            }.collect { it.entry as Map }
        }
        symbolHits = symbolHits.sort(false) { Map a, Map b ->
            Double.compare(b.score as double, a.score as double) ?:
                ((a.entry as Map).name as String).length() <=> ((b.entry as Map).name as String).length()
        }
        List<Map> merged = mergeComponentHits(symbolHits)

        //------------------------
        // Members
        //------------------------
        def memberOpts = baseOptions(memberHeads, terms, querySet)
        memberOpts.boost = MEMBER_BOOST
        memberOpts.filter = { int id ->
            Map m = library.memberIndex[id]
            String owner = m.ownerName as String
            if (!isPropsOwner(owner)) return true
            String lower = owner.toLowerCase(Locale.ROOT)
            return named.contains(lower) || named.contains(lower[0..-6])
        } as MiniSearch.Filter

        List<Map> allMemberHits = SearchText.rankByCoverage(memberIndex.search(terms, memberOpts), terms.size()).collect { SearchText.Ranked r ->
            Map entry = library.memberIndex[r.hit.id]
            String importPath = ownerImportPaths.get("${entry.ownerName}|${entry.filePath}".toString())
            boolean exact = named.contains((entry.name as String).toLowerCase(Locale.ROOT))
            double s = (exact ? r.hit.score * EXACT_NAME_BOOST : r.score) * symbolWeight(importPath, entry.ownerName == 'Promise')
            if (exact && named.contains((entry.ownerName as String).toLowerCase(Locale.ROOT))) s *= OWNER_NAMED_BOOST
            if (entry.docInheritedFrom) s *= INHERITED_DOC_WEIGHT
            [entry: entry, score: s, importPath: importPath] as Map
        }
        List<Map> visibleMemberHits = includeInternal ? allMemberHits : allMemberHits.findAll { !isInternal(it.entry as Map) }
        Set<String> seen = [] as Set<String>
        List<Map> memberHits = visibleMemberHits.findAll { Map h ->
            Map e = h.entry as Map
            seen.add("${e.ownerName}.${e.name}:${e.type}".toString())
        }.sort(false) { Map a, Map b ->
            Map ea = a.entry as Map, eb = b.entry as Map
            Double.compare(b.score as double, a.score as double) ?:
                (ea.ownerName as String).length() <=> (eb.ownerName as String).length() ?:
                (ea.name as String).length() <=> (eb.name as String).length()
        }

        ret.symbols = merged.take(limit).collect { Map h ->
            Map e = h.entry as Map
            new SymbolHit(
                entry: e, score: h.score as double,
                summary: SearchText.firstSentence(e.doc as String, SUMMARY_CHARS),
                hasMembers: e.kind == 'class' || e.kind == 'interface' || e.kind == 'trait',
                factory: h.factory as String, props: h.props as String
            )
        }
        ret.members = memberHits.take(limit).collect { Map h ->
            Map e = h.entry as Map
            new MemberHit(entry: e, score: h.score as double, importPath: h.importPath as String,
                summary: SearchText.firstSentence(e.doc as String, MEMBER_SUMMARY_CHARS))
        }
        ret.symbolTotal = merged.size()
        ret.memberTotal = memberHits.size()
        ret.hiddenSymbols = allSymbolHits.size() - symbolHits.size()
        ret.hiddenMembers = allMemberHits.size() - visibleMemberHits.size()
        return ret
    }

    private static MiniSearch.SearchOptions baseOptions(Map<String, String> heads, List<String> terms, Set<String> querySet) {
        new MiniSearch.SearchOptions(
            prefix: { String t -> t.length() >= 3 } as MiniSearch.TermOption,
            boostDocument: { int id, String term ->
                SearchText.isRedundantCompoundMatch(heads, term, terms, querySet) ? 0d : 1d
            } as MiniSearch.DocBoost
        )
    }

    static boolean isPropsOwner(String ownerName) {
        ownerName.endsWith('Props')
    }

    double symbolWeight(String importPath, boolean noImport) {
        if (!library.typeScript) return 1d
        if (!importPath) return noImport ? 1d : FILE_IMPORT_WEIGHT
        return importPath.startsWith('@xh/hoist/kit/') ? KIT_WEIGHT : 1d
    }

    boolean isInternal(Map entry) {
        internalDir(entry.filePath as String) != null
    }

    /** The internal directory a file sits in, or null. TypeScript libraries only. */
    String internalDir(String filePath) {
        if (!library.typeScript) return null
        List<String> dirs = filePath.tokenize('/')
        if (dirs) dirs = dirs.subList(0, dirs.size() - 1)
        if (dirs && INTERNAL_TOP_DIRS.contains(dirs[0])) return dirs[0]
        return dirs.contains(INTERNAL_SEGMENT) ? INTERNAL_SEGMENT : null
    }

    /** Fold a component, its element factory and its Props interface into one hit. */
    private static List<Map> mergeComponentHits(List<Map> hits) {
        Map<String, Map> groups = [:]
        List<Map> merged = []
        Closure<String> role = { Map e ->
            String name = e.name as String
            if (e.kind == 'const') return Character.isUpperCase(name.charAt(0)) ? 'component' : 'factory'
            if (e.kind == 'interface' && name.endsWith('Props') && name.length() > 5) return 'props'
            return null
        }
        for (Map hit : hits) {
            Map e = hit.entry as Map
            String r = role(e)
            if (!r) {
                merged << hit
                continue
            }
            String base = r == 'props' ? (e.name as String)[0..-6] : e.name as String
            String key = "${e.filePath}|${base[0].toLowerCase()}${base.substring(1)}".toString()
            Map group = groups.get(key)
            if (!group) {
                Map it = new LinkedHashMap(hit)
                groups.put(key, it)
                merged << it
                continue
            }
            String current = role(group.entry as Map)
            if (r == current) continue
            if (r == 'props') group.props = e.name
            else if (r == 'factory') group.factory = e.name
            if (r == 'component' || (r == 'factory' && current == 'props')) {
                if (current == 'props') group.props = (group.entry as Map).name
                else if (current == 'factory') group.factory = (group.entry as Map).name
                group.entry = e
            }
        }
        return merged
    }
}
