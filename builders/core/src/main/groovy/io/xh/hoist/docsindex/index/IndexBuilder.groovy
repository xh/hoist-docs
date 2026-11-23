/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

package io.xh.hoist.docsindex.index

import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import io.xh.hoist.docsindex.ContentSource
import io.xh.hoist.docsindex.LocalContentSource
import io.xh.hoist.docsindex.data.GroovyRegistry
import io.xh.hoist.docsindex.data.GroovyRegistry.MemberIndexEntry
import io.xh.hoist.docsindex.data.GroovyRegistry.MemberInfo
import io.xh.hoist.docsindex.data.GroovyRegistry.ParameterInfo
import io.xh.hoist.docsindex.data.GroovyRegistry.SymbolEntry
import io.xh.hoist.docsindex.util.IndexLog

import java.time.Instant
import java.util.zip.GZIPOutputStream

/**
 * Builds the Hoist Docs index file for a checkout of hoist-core or another Grails library.
 *
 * Writes one JSON file (schema v1, see the hoist-docs repo's `docs/index-schema.md`) holding the
 * doc registry and markdown, every indexed symbol with its detail and members precomputed, and the
 * member search index. The Hoist Docs service reads this file; it never parses hoist-core source.
 *
 * Published as `io.xh:hoist-docs-builder`. A Grails library runs it from its own build and attaches
 * the output to its Maven publication, classifier `docs-index`, so the index ships beside its jar.
 *
 * Usage: `--root <checkout> [--version <v>]` and the output - `--file <path>` (gzipped when it ends
 * `.gz`), else `--out <dir>` (default `indexes`) with `--gzip`, writing `<id>-<version>.json[.gz]`.
 * The version defaults to `xhReleaseVersion`, else `version`, in the checkout's
 * `gradle.properties`. Pass `--version` for a tag, whose commit carries the next snapshot version.
 * A Grails library other than hoist-core passes `--library <id>`, `--name <group:artifact>` and
 * optionally `--description <text>`.
 */
class IndexBuilder {

    static final int SCHEMA_VERSION = 1

    /** hoist-core, the library built when none is named. */
    static final Map<String, String> HOIST_CORE = [
        id         : 'core',
        name       : 'io.xh:hoist-core',
        description: 'Server half of the Hoist toolkit: a Grails plugin providing services, controllers, caching, clustering, config, prefs, roles and monitoring.'
    ]

    /** Ids of XH's other libraries, which another library may not take. */
    static final List<String> RESERVED_IDS = ['react', 'chat-kit']

    /** Longest agent guidance kept from a library's registry, as in the TypeScript builder. */
    static final int MAX_LIBRARY_INSTRUCTIONS_CHARS = 1500

    final ContentSource source
    final String version
    /** The library's `id`, `name` and `description`. */
    final Map<String, String> library

    IndexBuilder(ContentSource source, String version, Map<String, String> library = HOIST_CORE) {
        this.source = source
        this.version = version
        this.library = library
    }

    Map build() {
        def registryJson = new JsonSlurper().parseText(source.readFile('docs/doc-registry.json')) as Map
        def docEntries = (registryJson.entries as List<Map>)
            .findAll {
                def exists = source.fileExists(it.id as String)
                if (!exists) IndexLog.warn("docs/doc-registry.json lists ${it.id}, but there is no such file - left out")
                exists
            }
            .collect { Map e ->
                [
                    id            : e.id,
                    title         : e.title,
                    mcpCategory   : e.mcpCategory,
                    viewerCategory: e.viewerCategory,
                    description   : e.description ?: '',
                    keywords      : e.keywords ?: [],
                    aliases       : e.aliases ?: [],
                    markdown      : source.readFile(e.id as String)
                ]
            }

        def registry = new GroovyRegistry(source)
        registry.beginInitialization()

        def symbols = registry.allSymbols().collect { SymbolEntry entry ->
            def detail = registry.getSymbolDetail(entry.name, entry.filePath)
            def members = registry.getMembers(entry.name, entry.filePath)
            compact([
                name         : entry.name,
                kind         : entry.kind,
                filePath     : entry.filePath,
                sourcePackage: entry.packageName,
                category     : entry.sourceCategory,
                isExported   : true,
                isAbstract   : entry.isAbstract ?: null,
                doc          : detail?.groovydoc ?: '',
                memberNames  : entry.memberNames ? entry.memberNames.join(' ') : null,
                signature    : detail?.signature ?: "${entry.kind} ${entry.name}",
                extends      : detail?.extendsClass,
                implements   : detail?.implementsList ?: null,
                decorators   : detail?.annotations ?: null,
                members      : members?.collect { memberJson(it) }
            ])
        }

        def memberIndex = registry.allMemberIndexEntries().collect { MemberIndexEntry m ->
            compact([
                name         : m.name,
                memberKind   : m.memberKind,
                ownerName    : m.ownerName,
                filePath     : m.filePath,
                sourcePackage: m.sourceCategory,
                isStatic     : m.isStatic,
                type         : m.type,
                doc          : m.groovydoc ?: '',
                decorators   : m.annotations ?: [],
                parameters   : parametersJson(m.parameters)
            ])
        }

        // hoist-core's guidance is part of the server instructions. Another library's comes from
        // its registry's `mcpInstructions`.
        def instructions = library.id == HOIST_CORE.id ? null : parseInstructions(registryJson.mcpInstructions)
        return [
            schemaVersion: SCHEMA_VERSION,
            library      : compact([
                id          : library.id,
                name        : library.name,
                version     : version,
                language    : 'groovy',
                gitSha      : gitSha(),
                builtAt     : Instant.now().toString(),
                description : library.description,
                instructions: instructions
            ]),
            docs         : [
                mcpCategories   : registryJson.mcpCategories ?: [],
                viewerCategories: registryJson.viewerCategories ?: [],
                entries         : docEntries
            ],
            symbols      : symbols,
            memberIndex  : memberIndex
        ]
    }

    private static Map memberJson(MemberInfo m) {
        compact([
            name       : m.name,
            kind       : m.kind,
            type       : m.type,
            isStatic   : m.isStatic,
            isAbstract : m.isAbstract ?: null,
            visibility : m.visibility,
            decorators : m.annotations ?: [],
            doc        : m.groovydoc ?: '',
            parameters : parametersJson(m.parameters),
            returns    : m.returns ? [type: m.type, description: m.returns] : null
        ])
    }

    /** A registry's `mcpInstructions`, a string or a list of lines, trimmed and capped. */
    private static String parseInstructions(Object raw) {
        if (raw == null) return null
        def valid = raw instanceof String || (raw instanceof List && raw.every { it instanceof String })
        if (!valid) {
            IndexLog.warn('ignored mcpInstructions: expected a string or an array of strings')
            return null
        }
        def lines = (raw instanceof List ? raw : [raw]).join('\n').split('\n')
        def text = lines.collect { it.trim() }.findAll { it }.join('\n')
        if (text.length() <= MAX_LIBRARY_INSTRUCTIONS_CHARS) return text ?: null
        IndexLog.warn("mcpInstructions cut to ${MAX_LIBRARY_INSTRUCTIONS_CHARS} of ${text.length()} characters")
        return text.substring(0, MAX_LIBRARY_INSTRUCTIONS_CHARS - 3) + '...'
    }

    private static List<Map> parametersJson(List<ParameterInfo> params) {
        return params ? params.collect { compact([name: it.name, type: it.type, description: it.description]) } : null
    }

    /** Drop null-valued keys so optional fields are absent rather than null. */
    private static Map compact(Map m) {
        m.findAll { k, v -> v != null }
    }

    private String gitSha() {
        try {
            def root = new File(source.rootDescription)
            def proc = ['git', 'rev-parse', 'HEAD'].execute(null, root)
            proc.waitFor()
            return proc.exitValue() == 0 ? proc.text.trim() : null
        } catch (ignored) {
            return null
        }
    }

    //------------------------------------------------------------------
    // CLI entry point
    //------------------------------------------------------------------
    static void main(String[] args) {
        def argList = args as List<String>
        def opt = { String name, String dflt -> def i = argList.indexOf(name); i >= 0 ? argList[i + 1] : dflt }
        def root = opt('--root', null)
        if (!root) {
            System.err.println('No checkout given - pass --root <dir>.')
            System.exit(1)
        }
        def library = HOIST_CORE,
            libraryId = opt('--library', null),
            name = opt('--name', null),
            project = rootProjectName(new File(root))
        if (!libraryId && project && project != 'hoist-core') {
            fail("${root} is '${project}', not hoist-core - pass --library <id> and --name <group:artifact>.")
        }
        if (libraryId && libraryId != HOIST_CORE.id) {
            if (!(libraryId ==~ /[a-z][a-z0-9-]*/) || libraryId in RESERVED_IDS) {
                fail("'${libraryId}' cannot be a library id - use lowercase letters, digits and -, and not ${RESERVED_IDS.join(', ')}.")
            }
            if (!name) fail("No name given for library '${libraryId}' - pass --name <group:artifact>.")
            library = [id: libraryId, name: name, description: opt('--description', null)]
        } else if (name || opt('--description', null)) {
            fail('--name and --description are for a library other than hoist-core - pass --library <id> as well.')
        }
        def file = opt('--file', null),
            version = opt('--version', null) ?: readVersion(new File(root)),
            gzip = file ? file.endsWith('.gz') : argList.contains('--gzip')
        if (!version) fail('No version found in gradle.properties - pass --version <v>.')

        long start = System.currentTimeMillis()
        def index = new IndexBuilder(new LocalContentSource(root), version, library).build()
        def json = JsonOutput.toJson(index)

        def out = file
            ? new File(file)
            : new File(opt('--out', 'indexes'), "${library.id}-${version}.json${gzip ? '.gz' : ''}")
        out.absoluteFile.parentFile.mkdirs()
        if (gzip) {
            out.withOutputStream { os -> new GZIPOutputStream(os).withWriter('UTF-8') { it << json } }
        } else {
            out.setText(json, 'UTF-8')
        }
        System.err.println("Wrote ${out}: ${index.docs.entries.size()} docs, ${index.symbols.size()} symbols, " +
            "${index.memberIndex.size()} member index entries in ${(System.currentTimeMillis() - start) / 1000}s")
        System.exit(0)
    }

    private static void fail(String message) {
        System.err.println(message)
        System.exit(1)
    }

    /** The `rootProject.name` in the checkout's `settings.gradle`, if any. */
    private static String rootProjectName(File root) {
        def settings = new File(root, 'settings.gradle')
        if (!settings.exists()) return null
        def m = settings.text =~ /(?m)^\s*rootProject\.name\s*=\s*['"]([^'"]+)['"]/
        return m.find() ? m.group(1) : null
    }

    private static String readVersion(File root) {
        def props = new Properties()
        def file = new File(root, 'gradle.properties')
        if (file.exists()) file.withInputStream { props.load(it) }
        return props.getProperty('xhReleaseVersion') ?: props.getProperty('version')
    }
}
