package io.xh.hoistdocs.index

import groovy.json.JsonSlurper
import spock.lang.IgnoreIf
import spock.lang.Shared
import spock.lang.Specification

/**
 * Checks that the Groovy search port ranks exactly as hoist-react's TypeScript search did.
 *
 * Fixtures in `src/test/resources/parity` record the TypeScript results for every query in
 * hoist-react's golden-set specs. They must be generated from the same hoist-react commit as the
 * index file under test. Run with `./gradlew test -PtestIndexDir=<dir holding react-*.json>`.
 */
@IgnoreIf({ !System.getProperty('hoistdocs.testIndexDir') })
class SearchParitySpec extends Specification {

    @Shared LibraryIndex react
    @Shared List<Map> docCases
    @Shared List<Map> symbolCases

    def setupSpec() {
        def dir = new File(System.getProperty('hoistdocs.testIndexDir'))
        def file = dir.listFiles().find { it.name ==~ /react-.*\.json(\.gz)?/ }
        react = LibraryIndex.load(file)
        docCases = new JsonSlurper().parse(getClass().getResource('/parity/doc-search.json')) as List<Map>
        symbolCases = new JsonSlurper().parse(getClass().getResource('/parity/symbol-search.json')) as List<Map>
    }

    def 'doc search returns the same sections, in order, with the same scores'() {
        expect:
        docCases.each { Map c ->
            def actual = react.docSearch.search(c.query as String, null, 10)
            List<Map> expected = c.results as List<Map>
            assert actual.collect { "${it.entry.id} > ${it.section.ref}" } ==
                expected.collect { "${it.id} > ${it.section}" }, "query: ${c.query}"
            actual.eachWithIndex { r, i ->
                assert Math.abs(r.score - (expected[i].score as double)) < 1e-6, "query: ${c.query} #${i}"
            }
        }
    }

    def 'symbol search returns the same symbols and members, in order, with the same scores'() {
        expect:
        symbolCases.each { Map c ->
            def actual = react.symbolSearch.search(c.query as String, [limit: 20, includeInternal: c.includeInternal])
            String label = "query: ${c.query} (includeInternal: ${c.includeInternal})"
            assert actual.symbols.collect { "${it.entry.name}|${it.entry.filePath}|${it.factory}|${it.props}" } ==
                (c.symbols as List<Map>).collect { "${it.name}|${it.filePath}|${it.factory}|${it.props}" }, label
            assert actual.members.collect { "${it.entry.ownerName}.${it.entry.name}" } ==
                (c.members as List<Map>).collect { "${it.owner}.${it.name}" }, label
            actual.symbols.eachWithIndex { h, i -> assert Math.abs(h.score - (c.symbols[i].score as double)) < 1e-6, "$label symbol #$i" }
            actual.members.eachWithIndex { h, i -> assert Math.abs(h.score - (c.members[i].score as double)) < 1e-6, "$label member #$i" }
            assert [actual.symbolTotal, actual.memberTotal, actual.hiddenSymbols, actual.hiddenMembers] ==
                [c.symbolTotal, c.memberTotal, c.hiddenSymbols, c.hiddenMembers], label
        }
    }
}
