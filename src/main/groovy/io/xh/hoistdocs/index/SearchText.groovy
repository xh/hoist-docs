package io.xh.hoistdocs.index

import groovy.transform.CompileStatic

import java.util.concurrent.ConcurrentHashMap
import java.util.regex.Matcher
import java.util.regex.Pattern

/**
 * Text pipeline shared by doc search and symbol search, so a query is processed the same way
 * whichever index it hits. Ported from hoist-react's `mcp/data/search-text.ts`.
 *
 * Terms are split on punctuation and camelCase (`persistWith` indexes as `persistwith`,
 * `persist`, and `with`), lowercased, filtered against a stop-word list, and lightly stemmed.
 */
@CompileStatic
class SearchText {

    static final Set<String> STOP_WORDS = (
        'a about after all also an and any are as at be been but by can could do does doing ' +
        'during each for from had has have how i if in into is it its just me my of on or our ' +
        'should so some such than that the their them then there these they this those to too ' +
        'up us via was we were what when where which while who why will with would you your ' +
        'hoist use used uses using want need way'
    ).split(' ') as Set<String>

    private static final Pattern NON_WORD = ~/[^\p{L}\p{N}]+/
    private static final Pattern CAMEL_SPLIT = ~/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/
    private static final Pattern HAS_UPPER = ~/[A-Z]/
    private static final Pattern DOUBLED = ~/([^aeiouylsz])\1$/
    private static final Pattern SENTENCE_END = ~/(?<!\b(?:e\.g|i\.e|vs|etc|cf))[.!?](?=\s|$)/
    private static final Pattern PARA_SPLIT = ~/\n\s*\n/
    private static final Pattern WS = ~/\s+/
    private static final Pattern JSDOC_LINK = ~/\{@link(?:code|plain)?\s+([^}|\s]+)(?:\s*\|\s*|\s+)?([^}]*)\}/

    /** Split text on anything other than letters and digits. */
    static List<String> tokenize(String text) {
        if (!text) return []
        return NON_WORD.split(text).findAll { it } as List<String>
    }

    static class SplitToken {
        String whole
        List<String> parts
        List<String> terms
    }

    private static final Map<String, SplitToken> SPLIT_CACHE = new ConcurrentHashMap<>()

    /** Index terms for one raw token: the whole token plus its camelCase parts. */
    static List<String> processTerm(String token) {
        splitToken(token).terms
    }

    /** The unique processed terms of a query string. */
    static List<String> queryTerms(String query) {
        new LinkedHashSet<String>(tokenize(query ?: '').collectMany { processTerm(it) }) as List<String>
    }

    static SplitToken splitToken(String token) {
        def cached = SPLIT_CACHE.get(token)
        if (cached != null) return cached

        List<String> rawParts = HAS_UPPER.matcher(token).find() ?
            (CAMEL_SPLIT.split(token) as List<String>) :
            [token]
        List<String> parts = rawParts.size() > 1 ?
            rawParts.collect { keep(it.toLowerCase(Locale.ROOT)) }.findAll { it != null } as List<String> :
            []
        String whole = keep(token.toLowerCase(Locale.ROOT))
        List<String> all = whole ? [whole] + parts : parts
        def ret = new SplitToken(whole: whole, parts: parts, terms: new LinkedHashSet<String>(all) as List<String>)
        SPLIT_CACHE.put(token, ret)
        return ret
    }

    private static String keep(String t) {
        t.length() < 2 || STOP_WORDS.contains(t) ? null : stem(t)
    }

    /** Light suffix stemming - plurals and -ation / -ing / -ed. */
    static String stem(String term) {
        if (term.length() < 4 || term.find(/\d/)) return term

        String t = term
        if (t.endsWith('ies') && t.length() > 4) t = t[0..-4] + 'y'
        else if (t.endsWith('sses')) t = t[0..-3]
        else if (t.endsWith('s') && !(t ==~ /.*(ss|us|is)$/)) t = t[0..-2]

        for (String suffix : ['ation', 'ing', 'ed']) {
            if (t.endsWith(suffix) && t.length() - suffix.length() >= 4) {
                t = t.substring(0, t.length() - suffix.length())
                if (suffix != 'ation' && DOUBLED.matcher(t).find()) t = t.substring(0, t.length() - 1)
                break
            }
        }
        return t
    }

    /** A term processor that records the head part of each compound it indexes. */
    static class CompoundTermProcessor implements MiniSearch.TermProcessor {
        final Map<String, String> compoundHeads = [:]

        List<String> process(String token) {
            def split = splitToken(token)
            if (split.whole && split.parts) compoundHeads.put(split.whole, split.parts[0])
            return split.terms
        }
    }

    /**
     * True when a prefix match on a compound term only repeats a match already counted on its
     * first camelCase part - so `persistWith` is not counted twice for the query `persist`.
     */
    static boolean isRedundantCompoundMatch(
        Map<String, String> compoundHeads, String term, List<String> terms, Set<String> querySet
    ) {
        String head = compoundHeads.get(term)
        return head && !querySet.contains(term) && terms.any { head.startsWith(it) }
    }

    static class Ranked {
        MiniSearch.Result hit
        double score
    }

    /** Scale each hit's score by the share of query terms it matched, highest first. */
    static List<Ranked> rankByCoverage(List<MiniSearch.Result> hits, int termCount) {
        hits.collect { new Ranked(hit: it, score: it.score * new HashSet<String>(it.queryTerms).size() / termCount) }
            .sort(false) { Ranked a, Ranked b -> Double.compare(b.score, a.score) }
    }

    //------------------------
    // Summaries
    //------------------------
    static class Summary {
        String summary
        String rest
    }

    /** Split doc text into its first sentence and the rest. */
    static Summary splitSummary(String jsDoc) {
        String text = (jsDoc ?: '').trim()
        if (!text) return new Summary(summary: '', rest: '')

        String paragraph = PARA_SPLIT.split(text, 2)[0],
               firstPara = collapse(unwrapLinks(paragraph))
        Matcher end = SENTENCE_END.matcher(firstPara)
        int cut = end.find() ? end.start() + 1 : firstPara.length()
        String summary = firstPara.substring(0, cut).trim(),
               restOfPara = firstPara.substring(cut).trim(),
               restParas = collapse(unwrapLinks(text.substring(paragraph.length())))
        return new Summary(summary: summary, rest: [restOfPara, restParas].findAll { it }.join(' '))
    }

    /** The first sentence of doc text, cut at a word boundary to `maxChars`. */
    static String firstSentence(String jsDoc, int maxChars) {
        String summary = splitSummary(jsDoc).summary
        if (summary.length() <= maxChars) return summary
        String cut = summary.substring(0, maxChars)
        int space = cut.lastIndexOf(' ')
        return (space > maxChars / 2 ? cut.substring(0, space) : cut) + '...'
    }

    private static String collapse(String s) {
        WS.matcher(s).replaceAll(' ').trim()
    }

    private static String unwrapLinks(String text) {
        Matcher m = JSDOC_LINK.matcher(text)
        StringBuilder sb = new StringBuilder()
        while (m.find()) {
            String label = (m.group(2) ?: '').trim()
            m.appendReplacement(sb, Matcher.quoteReplacement(label ?: m.group(1)))
        }
        m.appendTail(sb)
        return sb.toString()
    }
}
