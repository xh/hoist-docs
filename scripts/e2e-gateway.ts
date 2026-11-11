/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * Smoke-test a running gateway (`hoist-docs --http`, or the image) end to end with a real MCP
 * client: `/health`, then every tool against every library and version it serves, over both the
 * 2026-07-28 and the 2025 handshake. Exits non-zero on any failure.
 *
 *   node scripts/e2e-gateway.ts [baseUrl]      # default http://localhost:8081
 *
 * For the image with local indexes:
 *   docker build -t hoist-docs-e2e .
 *   docker run --rm -d -p 8081:8081 -v "$PWD/indexes:/app/indexes:ro" -e INDEX_DIR=/app/indexes \
 *       --name hoist-docs-e2e hoist-docs-e2e
 *   node scripts/e2e-gateway.ts
 */
import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client';

const base = (process.argv[2] ?? 'http://localhost:8081').replace(/\/$/, '');

/** Per library: a doc query and a class to look up, all expected to exist. */
const PROBES: Record<string, {docs: string; symbol: string}> = {
    react: {docs: 'grid sorting', symbol: 'GridModel'},
    core: {docs: 'cache', symbol: 'BaseService'},
    'chat-kit': {docs: 'transport', symbol: 'ChatModel'}
};

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
}

const text = (r: any): string => r.content?.map((c: any) => c.text ?? '').join('\n') ?? '';
const firstLine = (s: string) =>
    s
        .split('\n')
        .find(l => l.trim())
        ?.slice(0, 100) ?? '';

const health = await fetch(`${base}/health`).then(r => r.json());
const libraries: Record<string, string[]> = health.libraries ?? {};
check('/health', Object.keys(libraries).length > 0, JSON.stringify(libraries));

for (const mode of ['auto', 'legacy'] as const) {
    console.log(`\n== ${mode} handshake`);
    const client = new Client({name: 'e2e-gateway', version: '1.0.0'}, {
        versionNegotiation: {mode}
    } as ConstructorParameters<typeof Client>[1]);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));

    const call = async (label: string, name: string, args: Record<string, unknown>) => {
        const t0 = Date.now();
        try {
            const r: any = await client.callTool({name, arguments: args});
            const body = text(r);
            check(
                label,
                !r.isError && body.length > 0,
                `${Date.now() - t0} ms, ${firstLine(body)}`
            );
            return body;
        } catch (e) {
            check(label, false, String(e));
            return '';
        }
    };

    const tools = await client.listTools();
    check('tools/list', tools.tools.length === 7, tools.tools.map(t => t.name).join(', '));
    await call('hoist-ping', 'hoist-ping', {});

    for (const [library, versions] of Object.entries(libraries)) {
        const probe = PROBES[library];
        for (const version of versions) {
            const at = {library, version},
                tag = `${library}@${version}`;
            await call(`${tag} list-docs`, 'hoist-list-docs', at);
            if (!probe) continue;
            const hits = await call(`${tag} search-docs`, 'hoist-search-docs', {
                ...at,
                query: probe.docs
            });
            const id = hits.match(/[\w:./-]+\.md/)?.[0];
            check(`${tag} search-docs gives a doc id`, !!id, id);
            if (id) await call(`${tag} read-doc ${id}`, 'hoist-read-doc', {...at, id});
            await call(`${tag} search-symbols`, 'hoist-search-symbols', {
                ...at,
                query: probe.symbol
            });
            await call(`${tag} get-symbol`, 'hoist-get-symbol', {...at, name: probe.symbol});
            await call(`${tag} get-members`, 'hoist-get-members', {...at, name: probe.symbol});
        }
    }

    const missing: any = await client.callTool({
        name: 'hoist-search-docs',
        arguments: {query: 'grid', library: 'react', version: '90.0.0'}
    });
    check('unknown version is a clear error', !!missing.isError, firstLine(text(missing)));
    await client.close();
}

console.log(failures ? `\n${failures} failed` : '\nAll passed');
process.exit(failures ? 1 : 0);
