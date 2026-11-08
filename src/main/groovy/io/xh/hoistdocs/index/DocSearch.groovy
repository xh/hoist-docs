package io.xh.hoistdocs.index

import groovy.transform.CompileStatic
import io.xh.hoistdocs.index.DocSections.DocSection

import java.util.regex.Matcher
import java.util.regex.Pattern

/**
 * Ranked section search over one library's docs. Each `##` / `###` section is indexed with its
 * breadcrumb as a boosted heading field. Ported from hoist-react's `mcp/data/doc-search.ts`,
 * keeping its tuning: field boosts, doc weights, prefix and fuzzy settings, and at most two
 * results per doc.
 */
@CompileStatic
class DocSearch {

    static final int DEFAULT_LIMIT = 5, MAX_LIMIT = 10
    static final int MAX_PER_DOC = 2
    static final int EXCERPT_CHARS = 360
    static final Map<String, Double> FIELD_BOOST = [heading: 3d, body: 1d]
    static final double DOC_META_BOOST = 1.3d

    static class Result {
        LibraryIndex.DocEntry entry
        DocSection section
        double score
        String excerpt
    }

    private static class Indexed {
        DocSection section
        LibraryIndex.DocEntry entry
    }

    private static final Pattern TOC_ROW_RE = ~/^\s*\|\s*\[[^\]]+\]\(#[^)]*\)\s*\|/
    private static final Pattern TABLE_RULE_RE = ~/^\s*\|?[\s:|-]+\|?\s*$/
    private static final Pattern SUBHEADING_RE = ~/(?m)^#{4,6}\s+(.+)$/
    private static final Pattern NON_WORD = ~/[^\p{L}\p{N}]/
    private static final Pattern SENTENCE_END_RE = ~/[.!?:](?=\s)/

    final LibraryIndex library
    private final MiniSearch miniSearch
    private final List<Indexed> sections = []
    private final Map<String, Set<String>> metaTerms = [:]
    private final Map<String, Double> weights = [:]
    private final Map<String, String> compoundHeads

    DocSearch(LibraryIndex library) {
        this.library = library
        def processor = new SearchText.CompoundTermProcessor()
        compoundHeads = processor.compoundHeads
        miniSearch = new MiniSearch(
            ['heading', 'body'],
            { String text -> SearchText.tokenize(text) } as MiniSearch.Tokenizer,
            processor
        )

        library.docs.each { LibraryIndex.DocEntry entry ->
            weights.put(entry.id, docWeight(entry))
            metaTerms.put(entry.id, SearchText.queryTerms(([entry.title, entry.description] + entry.keywords).join(' ')) as Set<String>)

            entry.sections.each { DocSection section ->
                String body = indexableBody(section.body)
                if (NON_WORD.matcher(body).replaceAll('').length() < 20) return
                sections << new Indexed(section: section, entry: entry)
                miniSearch.add([([section.breadcrumb] + subHeadings(body)).join(' '), body])
            }
        }
    }

    /** Weight per doc - upgrade notes, this tooling's own README, and indexes rank lower. */
    static double docWeight(LibraryIndex.DocEntry entry) {
        if (entry.id.startsWith('docs/upgrade-notes/')) return 0.5d
        if (entry.id == 'mcp/README.md') return 0.5d
        if (entry.mcpCategory == 'index') return 0.6d
        return 1d
    }

    List<Result> search(String query, String category = null, Integer limit = null) {
        List<String> terms = SearchText.queryTerms(query)
        if (!terms) return []

        int max = Math.min(Math.max(limit ?: DEFAULT_LIMIT, 1), MAX_LIMIT)
        String cat = category && category != 'all' ? category : null
        Set<String> querySet = terms as Set<String>

        def opts = new MiniSearch.SearchOptions(
            boost: FIELD_BOOST,
            prefix: { String t -> t.length() >= 3 } as MiniSearch.TermOption,
            fuzzy: { String t -> t.length() >= 6 ? (Object) 0.2d : (Object) false } as MiniSearch.TermOption,
            maxFuzzy: 2,
            boostDocument: { int id, String term ->
                if (SearchText.isRedundantCompoundMatch(compoundHeads, term, terms, querySet)) return 0d
                String docId = sections[id].entry.id
                return weights.get(docId) * (metaTerms.get(docId)?.contains(term) ? DOC_META_BOOST : 1d)
            } as MiniSearch.DocBoost,
            filter: cat ? ({ int id -> sections[id].entry.mcpCategory == cat } as MiniSearch.Filter) : null
        )

        def ranked = SearchText.rankByCoverage(miniSearch.search(terms, opts), terms.size())

        List<Result> picked = []
        Map<String, Integer> perDoc = [:]
        for (SearchText.Ranked it : ranked) {
            if (picked.size() >= max) break
            def indexed = sections[it.hit.id]
            int count = perDoc.get(indexed.entry.id) ?: 0
            if (count >= MAX_PER_DOC) continue
            perDoc.put(indexed.entry.id, count + 1)
            picked << new Result(entry: indexed.entry, section: indexed.section, score: it.score, excerpt: makeExcerpt(indexed.section.body))
        }
        return picked
    }

    //------------------------
    // Text processing
    //------------------------
    private static String indexableBody(String body) {
        body.split('\n', -1).findAll { !TOC_ROW_RE.matcher(it).find() }.join('\n')
    }

    private static List<String> subHeadings(String body) {
        Matcher m = SUBHEADING_RE.matcher(body)
        List<String> ret = []
        while (m.find()) ret << m.group(1)
        return ret
    }

    /** Leading prose of a section, skipping tables, code, and link definitions, cut at a sentence. */
    static String makeExcerpt(String body) {
        List<String> kept = []
        boolean inFence = false
        int length = 0
        for (String raw : body.split('\n', -1)) {
            String line = raw.trim()
            if (DocSections.FENCE_RE.matcher(line).find()) {
                if (!inFence && length >= EXCERPT_CHARS / 3) break
                inFence = !inFence
                continue
            }
            if (!line || TOC_ROW_RE.matcher(line).find() || TABLE_RULE_RE.matcher(line).find() ||
                DocSections.LINK_DEF_RE.matcher(line).find()) continue

            kept << DocSections.stripLinks(line.replaceAll(/^#{1,6}\s+/, ''))
            length += line.length()
            if (length > EXCERPT_CHARS) break
        }

        String text = kept.join(' ').replaceAll(/\s+/, ' ')
        if (text.length() <= EXCERPT_CHARS) return text

        String cut = text.substring(0, EXCERPT_CHARS)
        Matcher m = SENTENCE_END_RE.matcher(cut)
        int lastSentence = -1
        while (m.find()) lastSentence = m.start()
        if (lastSentence >= EXCERPT_CHARS / 2) return cut.substring(0, lastSentence + 1)
        return cut.substring(0, cut.lastIndexOf(' ')) + '...'
    }
}
