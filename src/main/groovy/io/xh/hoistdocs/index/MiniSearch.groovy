package io.xh.hoistdocs.index

import groovy.transform.CompileStatic

/**
 * A faithful port of the parts of MiniSearch 7 (https://github.com/lucaong/minisearch) that the
 * Hoist doc and symbol search use: per-field term indexing, and BM25+ scoring with exact, prefix
 * and fuzzy term expansion, OR-combined across query terms.
 *
 * hoist-react's search was tuned - and its golden-set specs written - against MiniSearch's exact
 * scoring, so this port keeps its formulas, weights and iteration order rather than swapping in a
 * different engine. A term's documents are kept in insertion order so that ties sort as they do
 * in MiniSearch.
 */
@CompileStatic
class MiniSearch {

    static final double BM25_K = 1.2, BM25_B = 0.7, BM25_D = 0.5
    static final double FUZZY_WEIGHT = 0.45, PREFIX_WEIGHT = 0.375

    /** Splits field text into raw tokens. */
    static interface Tokenizer { List<String> tokenize(String text) }

    /** Turns one raw token into zero or more index terms. */
    static interface TermProcessor { List<String> process(String token) }

    /** Per-term, per-document boost. Return 0 to drop the match. */
    static interface DocBoost { double boost(int docId, String derivedTerm) }

    static interface TermOption { Object apply(String term) }

    static interface Filter { boolean accept(int docId) }

    static class SearchOptions {
        Map<String, Double> boost = [:]
        /** Returns true to expand this query term by prefix. */
        TermOption prefix
        /** Returns a fuzziness ratio (< 1), an absolute distance (>= 1), or false/null. */
        TermOption fuzzy
        int maxFuzzy = 6
        DocBoost boostDocument
        Filter filter
    }

    static class Result {
        int id
        double score
        /** Query terms that matched, in order of first match. */
        List<String> queryTerms = []
        /** Document terms that matched - the query term or its prefix / fuzzy expansions. */
        Map<String, List<String>> match = [:]
    }

    final List<String> fields
    final Tokenizer tokenizer
    final TermProcessor termProcessor

    // term -> fieldId -> (docId -> term frequency), docs in insertion order
    private final TreeMap<String, Map<Integer, LinkedHashMap<Integer, Integer>>> index = new TreeMap<>()
    private final List<int[]> fieldLength = []
    private final double[] avgFieldLength
    private int documentCount = 0

    MiniSearch(List<String> fields, Tokenizer tokenizer, TermProcessor termProcessor) {
        this.fields = fields
        this.tokenizer = tokenizer
        this.termProcessor = termProcessor
        this.avgFieldLength = new double[fields.size()]
    }

    int getDocumentCount() { documentCount }

    /**
     * Add a document. Its id is its position in insertion order, starting at 0. `values` holds
     * the text of each field, in `fields` order; null skips that field.
     */
    int add(List<String> values) {
        int docId = documentCount++
        int[] lengths = new int[fields.size()]
        fieldLength << lengths
        for (int fieldId = 0; fieldId < fields.size(); fieldId++) {
            String value = values[fieldId]
            if (value == null) continue
            List<String> tokens = tokenizer.tokenize(value)
            int uniqueTerms = new HashSet<String>(tokens).size()
            lengths[fieldId] = uniqueTerms
            // Running mean, computed as MiniSearch does.
            int count = documentCount - 1
            avgFieldLength[fieldId] = (avgFieldLength[fieldId] * count + uniqueTerms) / (count + 1)
            for (String token : tokens) {
                for (String term : termProcessor.process(token)) {
                    if (term) addTerm(fieldId, docId, term)
                }
            }
        }
        return docId
    }

    private void addTerm(int fieldId, int docId, String term) {
        def byField = index.get(term)
        if (byField == null) index.put(term, byField = new HashMap<Integer, LinkedHashMap<Integer, Integer>>())
        def freqs = byField.get(fieldId)
        if (freqs == null) byField.put(fieldId, freqs = new LinkedHashMap<Integer, Integer>())
        Integer current = freqs.get(docId)
        freqs.put(docId, current == null ? 1 : current + 1)
    }

    /**
     * Search with already-processed query terms (space-separated), OR-combining their results.
     * Results are sorted by score, highest first; ties keep insertion order.
     */
    List<Result> search(List<String> terms, SearchOptions options) {
        Map<Integer, Result> combined = null
        for (String term : terms) {
            if (!term) continue
            def results = executeTerm(term, options)
            if (combined == null) {
                combined = results
            } else {
                results.each { Integer docId, Result r ->
                    def existing = combined.get(docId)
                    if (existing == null) {
                        combined.put(docId, r)
                    } else {
                        existing.score += r.score
                        existing.match.putAll(r.match)
                        r.queryTerms.each { if (!existing.queryTerms.contains(it)) existing.queryTerms << it }
                    }
                }
            }
        }
        if (combined == null) return []

        List<Result> ret = []
        combined.values().each { Result r ->
            int quality = r.queryTerms.size() ?: 1
            r.score = r.score * quality
            if (options.filter == null || options.filter.accept(r.id)) ret << r
        }
        // Stable sort, highest score first - as MiniSearch's byScore.
        return ret.sort(false) { Result a, Result b -> Double.compare(b.score, a.score) }
    }

    private Map<Integer, Result> executeTerm(String term, SearchOptions options) {
        Map<Integer, Result> results = new LinkedHashMap<>()
        termResults(term, term, 1d, index.get(term), options, results)

        Map<String, Map<Integer, LinkedHashMap<Integer, Integer>>> prefixMatches = null
        Map<String, Integer> fuzzyMatches = null

        if (options.prefix != null && isTrue(options.prefix.apply(term))) {
            prefixMatches = index.subMap(term, true, term + Character.MAX_VALUE, false)
        }
        if (options.fuzzy != null) {
            Object fuzzy = options.fuzzy.apply(term)
            if (fuzzy instanceof Number || fuzzy == Boolean.TRUE) {
                double f = fuzzy == Boolean.TRUE ? 0.2d : ((Number) fuzzy).doubleValue()
                int maxDistance = f < 1 ? Math.min(options.maxFuzzy, (int) Math.round(term.length() * f)) : (int) f
                if (maxDistance) fuzzyMatches = fuzzyGet(term, maxDistance)
            }
        }

        if (prefixMatches) {
            prefixMatches.each { String t, Map<Integer, LinkedHashMap<Integer, Integer>> data ->
                int distance = t.length() - term.length()
                if (!distance) return
                fuzzyMatches?.remove(t)
                double weight = PREFIX_WEIGHT * t.length() / (t.length() + 0.3 * distance)
                termResults(term, t, weight, data, options, results)
            }
        }
        if (fuzzyMatches) {
            fuzzyMatches.each { String t, Integer distance ->
                if (!distance) return
                double weight = FUZZY_WEIGHT * t.length() / (t.length() + distance)
                termResults(term, t, weight, index.get(t), options, results)
            }
        }
        return results
    }

    private void termResults(
        String sourceTerm,
        String derivedTerm,
        double termWeight,
        Map<Integer, LinkedHashMap<Integer, Integer>> fieldTermData,
        SearchOptions options,
        Map<Integer, Result> results
    ) {
        if (fieldTermData == null) return
        for (int fieldId = 0; fieldId < fields.size(); fieldId++) {
            String field = fields[fieldId]
            Double fb = options.boost[field]
            double fieldBoost = fb ?: 1d
            def freqs = fieldTermData.get(fieldId)
            if (freqs == null) continue
            int matchingFields = freqs.size()
            double avg = avgFieldLength[fieldId]
            freqs.each { Integer docId, Integer termFreq ->
                double docBoost = options.boostDocument ? options.boostDocument.boost(docId, derivedTerm) : 1d
                if (!docBoost) return
                int len = fieldLength[docId][fieldId]
                double raw = bm25(termFreq, matchingFields, documentCount, len, avg)
                double weighted = termWeight * fieldBoost * docBoost * raw
                def r = results.get(docId)
                if (r != null) {
                    r.score += weighted
                    if (!r.queryTerms.contains(sourceTerm)) r.queryTerms << sourceTerm
                    def m = r.match.get(derivedTerm)
                    if (m != null) m << field else r.match.put(derivedTerm, [field])
                } else {
                    r = new Result(id: docId, score: weighted)
                    r.queryTerms << sourceTerm
                    r.match.put(derivedTerm, [field])
                    results.put(docId, r)
                }
            }
        }
    }

    static double bm25(int termFreq, int matchingCount, int totalCount, int fieldLength, double avgFieldLength) {
        double idf = Math.log(1 + (totalCount - matchingCount + 0.5) / (matchingCount + 0.5))
        return idf * (BM25_D + termFreq * (BM25_K + 1) / (termFreq + BM25_K * (1 - BM25_B + BM25_B * fieldLength / avgFieldLength)))
    }

    /** Index terms within `maxDistance` edits of `term`, with their distance. */
    private Map<String, Integer> fuzzyGet(String term, int maxDistance) {
        Map<String, Integer> ret = new LinkedHashMap<>()
        int n = term.length()
        for (String candidate : index.keySet()) {
            if (Math.abs(candidate.length() - n) > maxDistance) continue
            int d = levenshtein(term, candidate, maxDistance)
            if (d <= maxDistance) ret.put(candidate, d)
        }
        return ret
    }

    /** Edit distance, or maxDistance + 1 once it is certain to exceed maxDistance. */
    private static int levenshtein(String a, String b, int maxDistance) {
        int m = a.length(), n = b.length()
        int[] prev = new int[n + 1], cur = new int[n + 1]
        for (int j = 0; j <= n; j++) prev[j] = j
        for (int i = 1; i <= m; i++) {
            cur[0] = i
            int rowMin = cur[0]
            for (int j = 1; j <= n; j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1
                cur[j] = Math.min(Math.min(prev[j] + 1, cur[j - 1] + 1), prev[j - 1] + cost)
                if (cur[j] < rowMin) rowMin = cur[j]
            }
            if (rowMin > maxDistance) return maxDistance + 1
            int[] tmp = prev; prev = cur; cur = tmp
        }
        return prev[n]
    }

    private static boolean isTrue(Object o) {
        o == Boolean.TRUE
    }
}
