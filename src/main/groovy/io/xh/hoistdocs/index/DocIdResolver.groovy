package io.xh.hoistdocs.index

import groovy.transform.CompileStatic

/**
 * Tolerant doc-id resolution for one library's docs: exact id, trivial normalization, case,
 * curated and generated aliases (`grid` → `cmp/grid/README.md`, `v85` → upgrade notes), then
 * structural suffix completion. Ported from hoist-react's `mcp/data/doc-id-resolver.ts`.
 */
@CompileStatic
class DocIdResolver {

    static class Resolution {
        String kind // exact | normalized | unknown
        LibraryIndex.DocEntry entry
        String matchedAs
        List<String> suggestions = []
    }

    private final List<LibraryIndex.DocEntry> entries
    private final Map<String, String> aliases

    DocIdResolver(List<LibraryIndex.DocEntry> entries) {
        this.entries = entries
        this.aliases = buildAliasMap(entries)
    }

    Resolution resolve(String input) {
        String raw = (input ?: '').trim()
        if (!raw) return new Resolution(kind: 'unknown')

        def exact = byId(raw)
        if (exact) return new Resolution(kind: 'exact', entry: exact)

        String cleaned = raw.replaceAll(/^\.\//, '').replaceAll(/^\/+/, '').replaceAll(/\/+/, '/').replaceAll(/\/+$/, '')
        if (cleaned != raw) {
            def hit = byId(cleaned)
            if (hit) return normalized(hit, raw)
        }

        String lower = cleaned.toLowerCase(Locale.ROOT)
        def caseHit = entries.find { it.id.toLowerCase(Locale.ROOT) == lower }
        if (caseHit) return normalized(caseHit, raw)

        String aliasTarget = aliases.get(lower)
        if (aliasTarget) {
            def hit = byId(aliasTarget)
            if (hit) return normalized(hit, raw)
        }

        Set<LibraryIndex.DocEntry> matches = new LinkedHashSet<>()
        suffixCandidates(cleaned).each { String c ->
            def hit = byId(c)
            if (hit) matches << hit
        }
        if (matches.size() == 1) return normalized(matches.first(), raw)

        return new Resolution(kind: 'unknown', suggestions: suggest(raw))
    }

    private LibraryIndex.DocEntry byId(String id) {
        entries.find { it.id == id }
    }

    private static Resolution normalized(LibraryIndex.DocEntry e, String raw) {
        new Resolution(kind: 'normalized', entry: e, matchedAs: raw)
    }

    private static List<String> suffixCandidates(String input) {
        if (input.endsWith('.md')) {
            String noMd = input[0..-4]
            return ["${noMd}/README.md".toString(), "docs/${input}".toString()]
        }
        if (input.endsWith('/README')) return ["${input}.md".toString()]

        List<String> out = [
            "${input}.md".toString(),
            "${input}/README.md".toString(),
            "docs/${input}.md".toString(),
            "docs/${input}/README.md".toString()
        ]
        def m = input =~ /(?i)^v(\d+)(?:-upgrade-notes)?$/
        if (m.matches()) out << "docs/upgrade-notes/v${m.group(1)}-upgrade-notes.md".toString()
        return out
    }

    private static Map<String, String> buildAliasMap(List<LibraryIndex.DocEntry> entries) {
        Map<String, Set<String>> autoCandidates = [:]
        entries.each { e ->
            String canonicalLower = e.id.toLowerCase(Locale.ROOT)
            pathAliasesFor(e.id).each { String key ->
                String lower = key.toLowerCase(Locale.ROOT)
                if (lower == canonicalLower) return
                autoCandidates.computeIfAbsent(lower) { new LinkedHashSet<String>() } << e.id
            }
        }

        Map<String, String> ret = [:]
        autoCandidates.each { String key, Set<String> ids ->
            if (ids.size() == 1) ret.put(key, ids.first())
        }

        Set<String> canonical = entries.collect { it.id.toLowerCase(Locale.ROOT) } as Set<String>
        Set<String> claimed = [] as Set<String>
        entries.each { e ->
            (e.aliases ?: []).each { String a ->
                String lower = a.toLowerCase(Locale.ROOT)
                if (canonical.contains(lower) && lower != e.id.toLowerCase(Locale.ROOT)) return
                if (claimed.contains(lower)) return
                claimed << lower
                ret.put(lower, e.id)
            }
        }
        return ret
    }

    private static List<String> pathAliasesFor(String path) {
        Set<String> out = new LinkedHashSet<>()
        String noMd = path.endsWith('.md') ? path[0..-4] : path
        out << noMd
        String noReadme = noMd.endsWith('/README') ? noMd[0..-8] : noMd
        out << noReadme
        String lastSeg = noReadme.tokenize('/') ? noReadme.tokenize('/').last() : null
        if (lastSeg) out << lastSeg
        if (noMd.startsWith('docs/')) {
            String stripped = noMd.substring(5)
            out << stripped
            String docsLast = stripped.tokenize('/') ? stripped.tokenize('/').last() : null
            if (docsLast) out << docsLast
        }
        def m = path =~ /\/v(\d+)-upgrade-notes\.md$/
        if (m.find()) out << "v${m.group(1)}".toString()
        return out as List<String>
    }

    private List<String> suggest(String input) {
        String lower = input.toLowerCase(Locale.ROOT)
        if (!lower) return []
        List<Map> scored = []
        entries.each { e ->
            String idLower = e.id.toLowerCase(Locale.ROOT)
            int score = 0
            if (idLower.contains(lower)) score += 10
            String stripped = idLower.replaceAll(/\.md$/, '').replaceAll(/\/readme$/, '')
            List<String> segs = stripped.tokenize('/')
            String lastSeg = segs ? segs.last() : ''
            if (lastSeg.contains(lower)) score += 5
            if (segs.any { it.startsWith(lower) }) score += 3
            if (score > 0) scored << [id: e.id, score: score]
        }
        scored.sort { Map a, Map b -> (b.score as int) <=> (a.score as int) ?: (a.id as String).length() <=> (b.id as String).length() }
        return scored.take(5).collect { it.id as String }
    }
}
