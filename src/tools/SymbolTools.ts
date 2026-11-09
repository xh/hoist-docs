/**
 * Symbol tools over one or more loaded libraries: search, describe one symbol, and list members.
 * Output text keeps the shapes agents saw from the stdio MCP servers this service replaces.
 * Groovy symbols (hoist-core) use the same shapes, with a Java-style import line.
 */
import {estimateTokens} from '../index/doc-sections.ts';
import type {LibraryIndex} from '../index/LibraryIndex.ts';
import {firstSentence} from '../index/search-text.ts';
import {
    DEFAULT_SEARCH_LIMIT,
    MAX_SEARCH_LIMIT,
    MEMBER_SUMMARY_CHARS,
    type MemberHit,
    type SymbolHit
} from '../index/SymbolSearch.ts';
import type {
    ExternalMemberGroup,
    Member,
    MemberKind,
    SymbolEntry,
    SymbolKind
} from '../index/types.ts';
import type {ToolOutput} from './types.ts';

const MAX_SUMMARY_MEMBERS = 60,
    MAX_EXTERNAL_LISTED = 40,
    FULL_DETAIL_MAX_TOKENS = 5000,
    SUMMARY_TYPE_LENGTH = 80,
    MAX_TYPE_LENGTH = 200;

export interface SymbolSearchArgs {
    kind?: string | null;
    exported?: boolean | null;
    includeInternal?: boolean | null;
    detail?: string | null;
    limit?: number | null;
}

export interface MembersArgs {
    name: string;
    filePath?: string | null;
    filter?: string | null;
    include?: string | null;
    memberKind?: MemberKind | null;
    detail?: string | null;
}

interface ImportRef {
    importPath: string | null;
    barrelExport: boolean;
}

type Json = Record<string, unknown>;

export class SymbolTools {
    readonly libraries: LibraryIndex[];

    constructor(libraries: LibraryIndex[]) {
        this.libraries = libraries;
    }

    //------------------------
    // Search
    //------------------------
    search(query: string, opts: SymbolSearchArgs = {}): ToolOutput {
        const detail = opts.detail || 'concise',
            limit = Math.min(Math.max(opts.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT),
            perLib = this.libraries.map(lib => ({
                lib,
                res: lib.symbolSearch.search(query, {...opts, limit})
            })),
            symbols = perLib
                .flatMap(({lib, res}) => res.symbols.map(hit => ({lib, hit})))
                .sort((a, b) => b.hit.score - a.hit.score)
                .slice(0, limit),
            members = perLib
                .flatMap(({lib, res}) => res.members.map(hit => ({lib, hit})))
                .sort((a, b) => b.hit.score - a.hit.score)
                .slice(0, limit),
            sum = (f: (r: (typeof perLib)[number]['res']) => number) =>
                perLib.reduce((acc, p) => acc + f(p.res), 0),
            symbolTotal = sum(r => r.symbolTotal),
            memberTotal = sum(r => r.memberTotal),
            hiddenSymbols = sum(r => r.hiddenSymbols),
            hiddenMembers = sum(r => r.hiddenMembers),
            hiddenExact = perLib.flatMap(({lib, res}) =>
                res.hiddenExact.map(entry => ({lib, entry}))
            );

        const lines: string[] = [];
        if (!symbols.length && !members.length) {
            lines.push(
                `No symbols or members matched "${query}". Try one strong keyword - an API name like "GridModel" or "persistWith" (camelCase names match their parts).`
            );
        }
        if (symbols.length) {
            lines.push(`Symbols (${symbols.length} of ${symbolTotal} matched "${query}"):`);
            symbols.forEach(({lib, hit}, i) => lines.push(...formatSymbolHit(lib, hit, i, detail)));
        }
        if (members.length) {
            if (lines.length) lines.push('');
            lines.push(`Members (${members.length} of ${memberTotal}):`);
            const hintedOwners = new Set<string>();
            members.forEach(({lib, hit}, i) => {
                lines.push(...formatMemberHit(lib, hit, i, detail, hintedOwners));
                hintedOwners.add(hit.entry.ownerName);
            });
        }

        lines.push(
            '',
            symbols.length || members.length
                ? 'Next: hoist-get-symbol {name} for signature, docs, and a member summary; hoist-get-members {name, filter} for member docs.'
                : 'For concepts and how-tos use hoist-search-docs.'
        );
        hiddenExact.forEach(({lib, entry: e}) =>
            lines.push(
                `Hidden exact match: ${e.name} (${e.filePath}) - internal (${lib.symbolSearch.internalDir(e.filePath)}/) code; pass includeInternal: true to see it.`
            )
        );
        if (hiddenSymbols + hiddenMembers > 0) {
            lines.push(
                `Hidden: ${plural(hiddenSymbols, 'internal symbol')}, ${plural(hiddenMembers, 'member')} (includeInternal: true shows them).`
            );
        }

        return {
            text: lines.join('\n'),
            structured: {
                query,
                detail,
                symbolCount: symbols.length,
                symbolTotal,
                memberCount: members.length,
                memberTotal,
                hiddenSymbols,
                hiddenMembers,
                hiddenExact: hiddenExact.map(({entry: e}) => ({
                    name: e.name,
                    kind: e.kind,
                    filePath: e.filePath
                })),
                symbols: symbols.map(({lib, hit}) => {
                    const ret: Json = {
                        ...symbolRef(lib, hit.entry),
                        summary: hit.summary,
                        hasMembers: hit.hasMembers
                    };
                    if (hit.factory) ret.factory = hit.factory;
                    if (hit.props) ret.props = hit.props;
                    if (hit.entry.hint) ret.hint = hit.entry.hint;
                    if (detail === 'full') ret.jsDoc = hit.entry.doc;
                    return ret;
                }),
                members: members.map(({lib, hit}) => {
                    const m = hit.entry,
                        ret: Json = {
                            name: m.name,
                            memberKind: m.memberKind,
                            ownerName: m.ownerName,
                            library: lib.name,
                            sourcePackage: m.sourcePackage,
                            filePath: m.filePath,
                            isStatic: m.isStatic,
                            type: m.type,
                            summary: hit.summary,
                            decorators: m.decorators ?? []
                        };
                    if (m.ownerHint) ret.ownerHint = m.ownerHint;
                    if (m.default != null) ret.default = m.default;
                    if (detail === 'full') ret.jsDoc = m.doc;
                    return ret;
                })
            }
        };
    }

    //------------------------
    // Get symbol
    //------------------------
    describe(name: string, filePath?: string | null, kind?: SymbolKind | null): ToolOutput {
        const found = this.locate(name, filePath, kind);
        if (!found) return notFound(name);

        const {lib, decls} = found,
            [primary, ...others] = decls,
            companions = lib.findCompanions(primary),
            alternates = filePath ? [] : lib.findAlternates(name, primary.filePath),
            members = primary.members;

        const lines: string[] = [];
        if (others.length) {
            lines.push(
                `${decls.length} declarations of "${name}" in ${primary.filePath}: ${decls.map(d => d.kind).join(' and ')}.`,
                ''
            );
        }
        lines.push(formatSymbolBlock(lib, primary, companions));
        others.forEach(d => lines.push('', '---', '', formatSymbolBlock(lib, d, [])));
        if (members != null) lines.push('', formatMemberSummary(lib, members));
        if (alternates.length) lines.push('', alternatesNote(name, alternates));

        const hint = (symbolNextHint(primary, companions) + filePathHint(alternates)).trim(),
            structured: Json = {
                requestedName: name,
                symbol: symbolDetail(lib, primary),
                otherDeclarations: others.map(d => symbolDetail(lib, d)),
                companions: companions.map(c => symbolRef(lib, c)),
                alternates: alternates.map(a => symbolRef(lib, a))
            };
        if (members != null) {
            structured.members = {
                total: members.length,
                shown: Math.min(members.length, MAX_SUMMARY_MEMBERS),
                list: members.slice(0, MAX_SUMMARY_MEMBERS).map(m => {
                    const r: Json = {
                        name: m.name,
                        kind: m.kind,
                        signature: memberSignature(lib, m, SUMMARY_TYPE_LENGTH),
                        isStatic: m.isStatic
                    };
                    if (m.inheritedFrom) r.inheritedFrom = m.inheritedFrom;
                    return r;
                })
            };
        }
        const text = lines.join('\n');
        return {text: hint ? `${text}\n\n${hint}` : text, structured};
    }

    //------------------------
    // Get members
    //------------------------
    members(args: MembersArgs): ToolOutput {
        const {name, filePath} = args,
            filter = args.filter || null,
            include = args.include || 'all',
            memberKind = args.memberKind || null;

        let lib: LibraryIndex | null = null,
            symbol: SymbolEntry | null = null;
        for (const l of this.libraries) {
            symbol =
                l.findSymbol(name, filePath, 'class') ??
                l.findSymbol(name, filePath, 'interface') ??
                l.findSymbol(name, filePath, 'trait') ??
                l.findSymbol(name, filePath);
            if (symbol) {
                lib = l;
                break;
            }
        }
        if (!symbol || !lib) return notFound(name);
        if (symbol.members == null) {
            const kinds = lib.findDeclarations(name, symbol.filePath).map(d => d.kind);
            return {
                isError: true,
                text: `"${name}" is a ${kinds.join(' and ')} (${symbol.filePath}), not a class or interface, so it has no members to list. Use hoist-get-symbol {name: "${name}"} to see its declaration.`
            };
        }

        const owner = symbol,
            ownerLib = lib,
            all = owner.members!,
            needle = filter?.toLowerCase(),
            nameMatches = (n: string) => !needle || n.toLowerCase().includes(needle),
            members = all.filter(
                m =>
                    nameMatches(m.name) &&
                    (!memberKind || m.kind === memberKind) &&
                    (include === 'all' || (include === 'own') === (m.inheritedFrom == null))
            ),
            allExternal = owner.externalMembers ?? [],
            totalExternal = allExternal.reduce((acc, g) => acc + g.members.length, 0),
            extKind = memberKind === 'accessor' ? 'property' : memberKind,
            external: ExternalMemberGroup[] =
                include === 'own'
                    ? []
                    : allExternal
                          .map(g => ({
                              ...g,
                              members: g.members.filter(
                                  m => nameMatches(m.name) && (!extKind || m.kind === extKind)
                              )
                          }))
                          .filter(g => g.members.length),
            alternates = filePath ? [] : ownerLib.findAlternates(name, owner.filePath);

        const filtering = !!(filter || include !== 'all' || memberKind),
            describeFilter = [
                filter ? `matching "${filter}"` : '',
                include !== 'all' ? `${include} only` : '',
                memberKind
                    ? `${memberKind === 'property' ? 'properties' : memberKind + 's'} only`
                    : ''
            ]
                .filter(Boolean)
                .join(', '),
            externalCount = external.reduce((acc, g) => acc + g.members.length, 0),
            header = filtering
                ? `# ${owner.name} Members ${describeFilter} (${members.length} of ${all.length}${totalExternal ? `, ${externalCount} of ${totalExternal} external` : ''})`
                : `# ${owner.name} Members (${members.length}${totalExternal ? `, plus ${totalExternal} external` : ''})`,
            headerLines = [header, `Import: ${importLine(ownerLib, owner)}`],
            own = members.filter(m => !m.inheritedFrom),
            inherited = members.filter(m => m.inheritedFrom),
            listed = external.map(g => {
                const generic = g.module === '@types/react' && !filter;
                return {
                    declaredIn: g.declaredIn,
                    module: g.module,
                    total: g.members.length,
                    members: generic ? [] : g.members.slice(0, MAX_EXTERNAL_LISTED)
                };
            });

        const renderBody = (level: string): string[] => {
            const out: string[] = [];
            formatMembersByCategory(ownerLib, own, out, level);
            const bySource = new Map<string, Member[]>();
            for (const m of inherited) {
                let list = bySource.get(m.inheritedFrom!);
                if (!list) bySource.set(m.inheritedFrom!, (list = []));
                list.push(m);
            }
            for (const [source, ms] of bySource) {
                out.push(`## Inherited from ${source} (${ms.length})`, '');
                formatMembersByCategory(ownerLib, ms, out, level);
            }
            if (!members.length)
                out.push(filtering ? 'No members match.' : 'No members found.', '');
            if (external.length) {
                out.push('## Inherited from types outside hoist-react', '');
                for (const g of listed) {
                    const from = g.module ? `${g.declaredIn} (${g.module})` : g.declaredIn;
                    if (!g.members.length) {
                        out.push(`### ${from} - ${g.total} standard React attributes, not listed`);
                    } else {
                        out.push(`### ${from} (${g.total})`);
                        g.members.forEach(m =>
                            out.push(`- ${m.name}${m.type ? `: ${m.type}` : ''}`)
                        );
                        if (g.members.length < g.total) {
                            out.push(`(${g.total - g.members.length} more not listed)`);
                        }
                    }
                    out.push('');
                }
            }
            if (alternates.length) out.push(alternatesNote(name, alternates), '');
            return out;
        };

        let detail = args.detail || 'full',
            body = renderBody(detail),
            note: string | null = null;
        if (!args.detail && !filtering && detail === 'full') {
            const fullTokens = estimateTokens([...headerLines, '', ...body].join('\n'));
            if (fullTokens > FULL_DETAIL_MAX_TOKENS) {
                detail = 'summary';
                body = renderBody(detail);
                note = `(one line per member: the full listing is ~${fullTokens.toLocaleString('en-US')} tokens. Narrow it with a filter, or ask for full detail to get complete JSDoc.)`;
            }
        } else if (detail === 'summary' && members.length) {
            note = '(one line per member, as requested; full detail gives complete JSDoc)';
        }

        const lines = [...headerLines, ...(note ? [note] : []), '', ...body],
            hint = `Narrow ${owner.name} with filter (substring), include: "own" | "inherited", or memberKind; detail: "full" forces docs on a long list. A filter also searches external groups marked "not listed".${filePathHint(alternates)}`,
            filterJson: Json = {include};
        if (filter) filterJson.filter = filter;
        if (memberKind) filterJson.memberKind = memberKind;

        return {
            text: `${lines.join('\n').trimEnd()}\n\n${hint}`,
            structured: {
                requestedName: name,
                owner: symbolDetail(ownerLib, owner),
                filter: filterJson,
                detail,
                totalMembers: all.length,
                members: members.map(memberJson),
                totalExternal,
                externalMembers: listed,
                alternates: alternates.map(a => symbolRef(ownerLib, a))
            }
        };
    }

    //------------------------
    // Implementation
    //------------------------
    /** First library whose index has the name, with its declarations. */
    private locate(
        name: string,
        filePath?: string | null,
        kind?: SymbolKind | null
    ): {lib: LibraryIndex; decls: SymbolEntry[]} | null {
        for (const lib of this.libraries) {
            const decls = lib.findDeclarations(name, filePath, kind);
            if (decls.length) return {lib, decls};
        }
        return null;
    }
}

//------------------------
// Formatting helpers
//------------------------
function notFound(name: string): ToolOutput {
    return {
        text: `Symbol "${name}" not found. Use hoist-search-symbols to find the exact name.`,
        isError: true
    };
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function collapseDoc(doc: string | undefined): string {
    return (doc ?? '')
        .split('\n')
        .filter(l => l.trim())
        .join('\n');
}

function indentDoc(doc: string | undefined, indent: string = '    '): string {
    return collapseDoc(doc)
        .split('\n')
        .map(l => indent + l)
        .join('\n');
}

function truncateType(type: string | undefined, max: number = MAX_TYPE_LENGTH): string {
    const t = type ?? '';
    return t.length > max ? t.slice(0, max) + '...' : t;
}

/** Import path and whether it is a package barrel, for a symbol in a library. */
function resolveImport(
    lib: LibraryIndex,
    e: Pick<
        SymbolEntry,
        'name' | 'filePath' | 'sourcePackage' | 'isExported' | 'importPath' | 'isPromiseExtension'
    >
): ImportRef {
    if (!lib.isTypeScript) {
        return {
            importPath: e.sourcePackage ? `${e.sourcePackage}.${e.name}` : null,
            barrelExport: false
        };
    }
    if (e.importPath) return {importPath: e.importPath, barrelExport: true};
    if (!e.isExported || e.isPromiseExtension) return {importPath: null, barrelExport: false};
    return {importPath: `@xh/hoist/${e.filePath.replace(/\.tsx?$/, '')}`, barrelExport: false};
}

function hitImport(
    lib: LibraryIndex,
    imp: ImportRef,
    filePath: string,
    isPromise: boolean
): string {
    if (imp.importPath) {
        if (!lib.isTypeScript) return imp.importPath;
        return imp.barrelExport ? imp.importPath : `${imp.importPath}; file import`;
    }
    return isPromise
        ? 'Promise prototype extension, no import needed'
        : `not exported - ${filePath}`;
}

function importLine(lib: LibraryIndex, d: SymbolEntry): string {
    const imp = resolveImport(lib, d);
    if (!lib.isTypeScript) return imp.importPath ? `import ${imp.importPath}` : 'none';
    if (imp.importPath) {
        const line = `import {${d.name}} from '${imp.importPath}';`;
        return imp.barrelExport ? line : `${line} (no package barrel re-exports this symbol)`;
    }
    if (d.isPromiseExtension) {
        return 'none needed - Promise prototype extension, available on every Promise';
    }
    return 'none - not exported from its file';
}

function memberLabel(m: Member): string {
    return `${m.isStatic ? 'static ' : ''}${m.name}${m.isOptional ? '?' : ''}`;
}

function memberSignature(
    lib: LibraryIndex,
    m: Member,
    typeLength: number = MAX_TYPE_LENGTH
): string {
    let sig: string;
    if (m.kind === 'method') {
        const params = (m.parameters ?? [])
                .map(p => `${p.name}: ${truncateType(p.type, typeLength)}`)
                .join(', '),
            ret = m.returnType || (lib.isTypeScript ? 'void' : m.type || 'void');
        sig = `${memberLabel(m)}(${params}): ${truncateType(ret, typeLength)}`;
    } else {
        sig = `${memberLabel(m)}: ${truncateType(m.type, typeLength)}`;
    }
    return m.default != null ? `${sig} = ${m.default}` : sig;
}

function symbolRef(lib: LibraryIndex, e: SymbolEntry): Json {
    return {
        name: e.name,
        kind: e.kind,
        library: lib.name,
        ...resolveImport(lib, e),
        sourcePackage: e.sourcePackage,
        filePath: e.filePath,
        exported: e.isExported
    };
}

function symbolDetail(lib: LibraryIndex, d: SymbolEntry): Json {
    const ret: Json = {...symbolRef(lib, d), signature: d.signature, jsDoc: d.doc ?? ''};
    for (const key of [
        'extends',
        'implements',
        'decorators',
        'constructorType',
        'instanceOf'
    ] as const) {
        const v = d[key];
        if (v && (!Array.isArray(v) || v.length)) ret[key] = v;
    }
    return ret;
}

function alternatesNote(name: string, alternates: SymbolEntry[]): string {
    if (!alternates.length) return '';
    const list = alternates
        .map(a => `  - [${a.kind}] ${a.sourcePackage} (${a.filePath})`)
        .join('\n');
    return `Note: ${alternates.length + 1} symbols named "${name}" exist. Others, selectable by file path:\n${list}`;
}

function filePathHint(alternates: SymbolEntry[]): string {
    return alternates.length
        ? ` Select an alternate with filePath: "${alternates[0].filePath}".`
        : '';
}

function formatSymbolHit(lib: LibraryIndex, hit: SymbolHit, i: number, detail: string): string[] {
    const e = hit.entry,
        kind = hit.factory || hit.props ? 'component' : e.kind,
        name = hit.factory ? `${e.name} / ${hit.factory}` : e.name,
        where = hitImport(lib, resolveImport(lib, e), e.filePath, e.isPromiseExtension === true),
        props = hit.props ? ` Props: ${hit.props}.` : '',
        hint = e.hint ? ` [${e.hint}]` : '';
    if (detail === 'full') {
        const ret = [
            `${i + 1}. [${kind}] ${name} (${where}; file: ${e.filePath}; exported: ${e.isExported ? 'yes' : 'no'})${props}${hint}`
        ];
        if (e.doc) ret.push(indentDoc(e.doc));
        return ret;
    }
    const summary = hit.summary ? ` - ${hit.summary}` : '';
    return [`${i + 1}. [${kind}] ${name} (${where})${summary}${props}${hint}`];
}

function formatMemberHit(
    lib: LibraryIndex,
    hit: MemberHit,
    i: number,
    detail: string,
    hintedOwners: Set<string>
): string[] {
    const m = hit.entry,
        label = `${m.isStatic ? 'static ' : ''}${m.ownerName}.${m.name}`,
        dflt = m.default != null ? ` = ${m.default}` : '',
        ownerHint =
            m.ownerHint && !hintedOwners.has(m.ownerName)
                ? ` [${m.ownerName}: ${m.ownerHint}]`
                : '';
    if (detail === 'full') {
        const isPromise = m.ownerName === 'Promise',
            imp: ImportRef = isPromise
                ? {importPath: null, barrelExport: false}
                : resolveImport(lib, {
                      name: m.ownerName,
                      filePath: m.filePath,
                      importPath: hit.importPath,
                      isExported: true,
                      sourcePackage: m.sourcePackage
                  }),
            ret = [
                `${i + 1}. [${m.memberKind}] ${label}: ${truncateType(m.type)}${dflt} (${hitImport(lib, imp, m.filePath, isPromise)})${ownerHint}`
            ];
        if (m.doc) ret.push(indentDoc(m.doc));
        return ret;
    }
    const summary = hit.summary ? ` - ${hit.summary}` : '';
    return [
        `${i + 1}. ${label}: ${truncateType(m.type, SUMMARY_TYPE_LENGTH)}${dflt}${summary}${ownerHint}`
    ];
}

function formatSymbolBlock(lib: LibraryIndex, d: SymbolEntry, companions: SymbolEntry[]): string {
    const lines = [
        `# ${d.name} (${d.kind})`,
        `Import: ${importLine(lib, d)}`,
        `Package: ${d.sourcePackage}`,
        `File: ${d.filePath}`,
        `Exported: ${d.isExported ? 'yes' : 'no'}`
    ];
    if (d.extends) lines.push(`Extends: ${d.extends}`);
    if (d.implements?.length) lines.push(`Implements: ${d.implements.join(', ')}`);
    if (d.decorators?.length) {
        lines.push(
            `${lib.isTypeScript ? 'Decorators' : 'Annotations'}: ${d.decorators.map(x => `@${x}`).join(', ')}`
        );
    }
    if (d.constructorType) lines.push(`Constructor: new ${d.name}(config: ${d.constructorType})`);
    if (d.instanceOf) lines.push(`Instance of: ${d.instanceOf}`);
    if (companions.length) {
        lines.push(
            d.kind === 'interface' && d.name.endsWith('Props')
                ? `Component: ${companions.map(c => c.name).join(', ')}`
                : `Props: ${companions[0].name}`
        );
    }
    lines.push('', '## Signature', d.signature);
    if (d.doc) lines.push('', '## Documentation', collapseDoc(d.doc));
    return lines.join('\n');
}

function formatMemberSummary(lib: LibraryIndex, members: Member[]): string {
    const own = members.filter(m => !m.inheritedFrom),
        inherited = members.filter(m => m.inheritedFrom),
        shown = members.slice(0, MAX_SUMMARY_MEMBERS),
        lines = [`## Members (${own.length} own, ${inherited.length} inherited)`];
    let lastSource: string | null = null;
    for (const m of shown) {
        if (m.inheritedFrom && m.inheritedFrom !== lastSource) {
            lines.push(`### Inherited from ${m.inheritedFrom}`);
            lastSource = m.inheritedFrom;
        }
        lines.push(`- ${memberSignature(lib, m, SUMMARY_TYPE_LENGTH)}`);
    }
    if (members.length > shown.length) {
        lines.push(`(${members.length - shown.length} more members not shown)`);
    }
    if (!members.length) lines.push('No members found.');
    return lines.join('\n');
}

function symbolNextHint(d: SymbolEntry, companions: SymbolEntry[]): string {
    const target = ['class', 'interface', 'trait'].includes(d.kind)
        ? d.name
        : (d.instanceOf ?? companions.find(c => c.kind === 'interface')?.name);
    if (!target) return '';
    const what =
        target === d.name
            ? 'Full member details'
            : target === d.instanceOf
              ? `Members of \`${target}\``
              : `Its props (\`${target}\`)`;
    return `${what}: hoist-get-members {name: "${target}"}; narrow with filter: "<text>", include: "own" | "inherited", or memberKind.`;
}

function memberJson(m: Member): Json {
    const ret: Json = {
        name: m.name,
        kind: m.kind,
        type: m.type,
        isStatic: m.isStatic,
        decorators: m.decorators ?? [],
        jsDoc: m.doc ?? ''
    };
    for (const key of [
        'isOptional',
        'default',
        'parameters',
        'returnType',
        'returns',
        'inheritedFrom'
    ] as const) {
        if (m[key] != null) ret[key] = m[key];
    }
    if (m.docInheritedFrom) ret.jsDocInheritedFrom = m.docInheritedFrom;
    return ret;
}

function formatMember(lib: LibraryIndex, m: Member, detail: string): string {
    const decorators = m.decorators ?? [],
        prefix = decorators.length ? decorators.map(d => `@${d}`).join(' ') + ' ' : '',
        inheritedSuffix = m.inheritedFrom ? `  (inherited from ${m.inheritedFrom})` : '';
    if (detail === 'summary') {
        const summary = firstSentence(m.doc ?? '', MEMBER_SUMMARY_CHARS);
        return `- ${prefix}${memberSignature(lib, m, SUMMARY_TYPE_LENGTH)}${summary ? ` - ${summary}` : ''}${inheritedSuffix}`;
    }
    const lines = [`- ${prefix}${memberSignature(lib, m)}${inheritedSuffix}`];
    if (m.doc) lines.push(indentDoc(m.doc));
    const described = (m.parameters ?? []).filter(p => p.description);
    if (described.length) {
        lines.push('    Parameters:');
        described.forEach(p =>
            lines.push(`      ${p.name}: ${p.description!.split('\n').join('\n        ')}`)
        );
    }
    if (m.returns?.description) {
        lines.push(`    Returns: ${m.returns.description.split('\n').join('\n      ')}`);
    }
    return lines.join('\n');
}

function formatMembersByCategory(
    lib: LibraryIndex,
    members: Member[],
    lines: string[],
    detail: string
) {
    const groups: Array<[string, Member[]]> = [
        ['Properties', members.filter(m => !m.isStatic && m.kind !== 'method')],
        ['Methods', members.filter(m => !m.isStatic && m.kind === 'method')],
        ['Static Properties', members.filter(m => m.isStatic && m.kind !== 'method')],
        ['Static Methods', members.filter(m => m.isStatic && m.kind === 'method')]
    ];
    for (const [title, group] of groups) {
        if (!group.length) continue;
        lines.push(`### ${title} (${group.length})`);
        group.forEach(m => lines.push(formatMember(lib, m, detail)));
        lines.push('');
    }
}
