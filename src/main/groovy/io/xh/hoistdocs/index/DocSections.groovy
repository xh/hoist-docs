package io.xh.hoistdocs.index

import groovy.transform.CompileStatic

import java.util.regex.Matcher
import java.util.regex.Pattern

/**
 * Splits docs into `##` / `###` sections and resolves section names. Ported from hoist-react's
 * `mcp/data/doc-sections.ts`, so every library's docs are sectioned by one implementation.
 */
@CompileStatic
class DocSections {

    /** A single `##` / `###` section of a doc, or the intro text before the first one. */
    static class DocSection {
        String docId
        /** 1 for the intro section, 2 or 3 for `##` / `###` sections. */
        int level
        /** Heading text with markdown formatting removed. */
        String heading
        /** Headings below the doc title. Empty for the intro. */
        List<String> path
        /** Value to pass as `section` to read this section. */
        String ref
        /** Display path including the doc title. */
        String breadcrumb
        int startLine
        /** Last line of the section's own text, before the next heading. */
        int endLine
        /** Last line including nested subsections - what a section read returns. */
        int extentEndLine
        int tokens
        /** The section's own text, excluding its heading line. */
        String body
    }

    static class Resolution {
        String kind // found | ambiguous | unknown
        DocSection section
        List<DocSection> candidates = []
        List<DocSection> suggestions = []
    }

    static final Pattern FENCE_RE = ~/^\s*(```|~~~)/
    static final Pattern HEADING_RE = ~/^(#{1,3})\s+(.+?)(?:\s+#+)?\s*$/
    static final Pattern LINK_DEF_RE = ~/^ {0,3}\[([^\]]+)\]:\s*\S/
    private static final Pattern INLINE_LINK_RE = ~/\[([^\]]+)\]\([^)]*\)/
    private static final Pattern REF_LINK_RE = ~/\[([^\]]+)\]\[([^\]]*)\]/
    private static final Pattern NON_WORD = ~/[^\p{L}\p{N}]+/

    /** Estimate LLM tokens at ~4 characters per token. */
    static int estimateTokens(String text) {
        (int) Math.ceil(text.length() / 4d)
    }

    /** Format a token estimate for display, e.g. `~6,760 tokens`. */
    static String formatTokens(int tokens) {
        "~${String.format(Locale.US, '%,d', tokens)} tokens"
    }

    /** Split content into lines, dropping the empty entry after a trailing newline. */
    static List<String> splitLines(String content) {
        List<String> lines = content.split('\n', -1) as List<String>
        if (lines && lines.last() == '') lines.removeLast()
        return lines
    }

    static String sliceLines(List<String> lines, int start, int end) {
        int from = Math.max(start - 1, 0), to = Math.min(end, lines.size())
        from < to ? lines.subList(from, to).join('\n') : ''
    }

    /** Reduce inline and reference links to their text. */
    static String stripLinks(String text) {
        REF_LINK_RE.matcher(INLINE_LINK_RE.matcher(text).replaceAll('$1')).replaceAll('$1')
    }

    /** Split a doc's markdown into sections. */
    static List<DocSection> parse(String docId, String docTitle, String content) {
        List<String> lines = splitLines(content)
        List<Map> headings = []
        boolean inFence = false
        String h1 = null
        int h1Line = 0

        lines.eachWithIndex { String line, int i ->
            if (FENCE_RE.matcher(line).find()) {
                inFence = !inFence
                return
            }
            if (inFence) return
            Matcher m = HEADING_RE.matcher(line)
            if (!m.matches()) return
            int level = m.group(1).length()
            String text = cleanHeading(m.group(2))
            if (level == 1) {
                if (h1 == null) {
                    h1 = text
                    h1Line = i + 1
                }
            } else {
                headings << [level: level, text: text, line: i + 1]
            }
        }

        int lastLine = lines.size()
        List<DocSection> sections = []
        int firstHeadingLine = headings ? (headings[0].line as int) : lastLine + 1

        if (firstHeadingLine > 1) {
            String heading = h1 ?: docTitle
            int endLine = firstHeadingLine - 1
            List<String> bodyLines = []
            for (int i = 0; i < endLine && i < lines.size(); i++) {
                if (i + 1 != h1Line) bodyLines << lines[i]
            }
            sections << new DocSection(
                docId: docId, level: 1, heading: heading, path: [], ref: heading,
                breadcrumb: docTitle, startLine: 1, endLine: endLine, extentEndLine: endLine,
                tokens: estimateTokens(sliceLines(lines, 1, endLine)), body: bodyLines.join('\n')
            )
        }

        String currentH2 = null
        headings.eachWithIndex { Map h, int idx ->
            int level = h.level as int, line = h.line as int
            String text = h.text as String
            int endLine = (idx + 1 < headings.size() ? (headings[idx + 1].line as int) : lastLine + 1) - 1

            if (level == 2) currentH2 = text
            List<String> path = level == 3 && currentH2 ? [currentH2, text] : [text]

            int extentEndLine = endLine
            if (level == 2) {
                def nextH2 = idx + 1 < headings.size() ? headings.subList(idx + 1, headings.size()).find { it.level == 2 } : null
                extentEndLine = (nextH2 ? (nextH2.line as int) : lastLine + 1) - 1
            }

            sections << new DocSection(
                docId: docId, level: level, heading: text, path: path, ref: path.join(' > '),
                breadcrumb: ([docTitle] + path).join(' > '), startLine: line, endLine: endLine,
                extentEndLine: extentEndLine,
                tokens: estimateTokens(sliceLines(lines, line, extentEndLine)),
                body: sliceLines(lines, line + 1, endLine)
            )
        }
        return sections
    }

    /**
     * The markdown for a section's full extent. Reference link definitions it uses but does not
     * contain are appended at the end.
     */
    static String getSectionContent(String content, DocSection section) {
        List<String> lines = splitLines(content)
        String body = sliceLines(lines, section.startLine, section.extentEndLine).replaceAll(/\s+$/, '')
        Set<String> used = referencedLabels(body)
        List<String> defs = []
        parseLinkDefinitions(lines).each { String label, Map linkDef ->
            int line = linkDef.line as int
            boolean inSection = line >= section.startLine && line <= section.extentEndLine
            if (used.contains(label) && !inSection) defs << (linkDef.text as String)
        }
        return defs ? "${body}\n\n${defs.join('\n')}" : body
    }

    /** Sections nested within (and including) the given section. */
    static List<DocSection> getSubsections(List<DocSection> sections, DocSection section) {
        sections.findAll { it.startLine >= section.startLine && it.startLine <= section.extentEndLine }
    }

    private static Map<String, Map> parseLinkDefinitions(List<String> lines) {
        Map<String, Map> ret = new LinkedHashMap<>()
        boolean inFence = false
        lines.eachWithIndex { String text, int i ->
            if (FENCE_RE.matcher(text).find()) {
                inFence = !inFence
                return
            }
            if (inFence) return
            Matcher m = LINK_DEF_RE.matcher(text)
            if (!m.find()) return
            String label = normalizeLabel(m.group(1))
            if (!ret.containsKey(label)) ret.put(label, [line: i + 1, text: text])
        }
        return ret
    }

    private static Set<String> referencedLabels(String markdown) {
        Set<String> ret = new HashSet<>()
        Matcher m = REF_LINK_RE.matcher(markdown)
        while (m.find()) ret << normalizeLabel(m.group(2) ?: m.group(1))
        return ret
    }

    private static String normalizeLabel(String label) {
        label.trim().replaceAll(/\s+/, ' ').toLowerCase(Locale.ROOT)
    }

    //------------------------
    // Resolution
    //------------------------
    /**
     * Resolve a caller-supplied section name: a heading, a path, or a full breadcrumb. Matching
     * ignores case, punctuation and markdown, trying in order exact path, exact tail, prefix
     * tail, then substring tail. A tier with several distinct matches is ambiguous.
     */
    static Resolution resolve(String docTitle, List<DocSection> sections, String input) {
        List<String> segments = splitSectionInput(input)
        if (!segments) return new Resolution(kind: 'unknown')

        DocSection intro = sections.find { it.level == 1 }
        List<String> titleKeys = [normalize(docTitle), normalize(intro?.heading ?: '')].findAll { it }

        if (segments.size() == 1 && titleKeys.contains(segments[0])) {
            def exact = sections.findAll { it.level > 1 && normalize(it.heading) == segments[0] }
            if (!exact && intro) return new Resolution(kind: 'found', section: intro)
        }
        if (segments.size() > 1 && titleKeys.contains(segments[0])) segments = segments.drop(1)

        final List<String> segs = segments
        List<DocSection> addressable = sections.findAll { it.level > 1 }
        List<Closure<Boolean>> tiers = [
            { List<String> keys -> keys.size() == segs.size() && tailMatches(keys, segs) { String k, String q -> k == q } },
            { List<String> keys -> tailMatches(keys, segs) { String k, String q -> k == q } },
            { List<String> keys -> tailMatches(keys, segs) { String k, String q -> k.startsWith(q) } },
            { List<String> keys -> tailMatches(keys, segs) { String k, String q -> k.contains(q) } }
        ] as List<Closure<Boolean>>

        for (Closure<Boolean> tier : tiers) {
            def matches = addressable.findAll { DocSection s -> tier.call(s.path.collect { normalize(it) }) }
            if (matches.size() == 1) return new Resolution(kind: 'found', section: matches[0])
            if (matches.size() > 1) {
                if (matches.collect { it.ref }.toSet().size() == 1) return new Resolution(kind: 'found', section: matches[0])
                return new Resolution(kind: 'ambiguous', candidates: matches)
            }
        }
        return new Resolution(kind: 'unknown', suggestions: suggestSections(sections, input))
    }

    private static boolean tailMatches(List<String> keys, List<String> segs, Closure<Boolean> cmp) {
        if (keys.size() < segs.size()) return false
        List<String> tail = keys.subList(keys.size() - segs.size(), keys.size())
        for (int i = 0; i < segs.size(); i++) {
            if (!cmp.call(tail[i], segs[i])) return false
        }
        return true
    }

    private static String cleanHeading(String raw) {
        stripLinks(raw.replaceAll(/\s*\{#[^}]*\}\s*$/, '')).replaceAll(/[`*]/, '').trim()
    }

    /** Lowercase and drop everything but letters and digits. */
    static String normalize(String s) {
        NON_WORD.matcher(s.toLowerCase(Locale.ROOT)).replaceAll('')
    }

    private static List<String> splitSectionInput(String input) {
        (input ?: '').split(/\s*[>›»]\s*/).collect { normalize(it) }.findAll { it } as List<String>
    }

    private static List<DocSection> suggestSections(List<DocSection> sections, String input) {
        List<String> words = NON_WORD.split((input ?: '').toLowerCase(Locale.ROOT)).findAll { it.length() > 1 } as List<String>
        if (!words) return []
        sections.findAll { it.level > 1 }
            .collect { DocSection s ->
                String key = normalize(s.ref)
                [s: s, score: words.count { key.contains(it) }]
            }
            .findAll { (it.score as int) > 0 }
            .sort(false) { Map a, Map b -> (b.score as int) <=> (a.score as int) }
            .take(5)
            .collect { it.s as DocSection }
    }
}
