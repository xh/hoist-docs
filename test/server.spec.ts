/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * The MCP server over HTTP, exercised with the official MCP client (SDK v2) in both protocol
 * eras: 2026-07-28, which opens with `server/discover`, and the 2025 `initialize` handshake that
 * older clients use.
 */
import type {AddressInfo} from 'node:net';
import type {Server} from 'node:http';

import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {loadConfig} from '../src/config.ts';
import {IndexStore} from '../src/IndexStore.ts';
import {createApp} from '../src/server.ts';
import {coreIndex, reactIndex, writeIndexDir} from './fixtures.ts';

const store = new IndexStore(
        writeIndexDir({
            'react-89.0.0.json': reactIndex('89.0.0'),
            'react-90.0.0.json': reactIndex('90.0.0'),
            'core-40.0.json': coreIndex('40.0')
        })
    ),
    config = loadConfig({}, 'test');
store.init();

let server: Server, base: string;

beforeAll(async () => {
    server = createApp(config, store);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

/** A connected MCP client: `auto` negotiates 2026-07-28, `legacy` uses the 2025 handshake. */
async function connect(mode: 'auto' | 'legacy'): Promise<Client> {
    const client = new Client({name: 'spec', version: '1.0.0'}, {
        versionNegotiation: {mode}
    } as ConstructorParameters<typeof Client>[1]);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    return client;
}

const text = (result: any): string => result.content[0].text;

describe.each(['auto', 'legacy'] as const)('MCP over HTTP (%s client)', mode => {
    let client: Client;
    beforeAll(async () => {
        client = await connect(mode);
    });
    afterAll(() => client.close());

    it('negotiates the expected protocol era', () => {
        if (mode === 'auto') {
            expect(client.getProtocolEra()).toBe('modern');
            expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
        } else {
            expect(client.getProtocolEra()).toBe('legacy');
        }
        expect(client.getServerVersion()).toMatchObject({name: 'hoist-docs', version: 'test'});
        expect(client.getInstructions()).toContain('react (@xh/hoist 90.0.0)');
    });

    it('lists seven read-only tools', async () => {
        const {tools} = await client.listTools();
        expect(tools.map(t => t.name)).toEqual([
            'hoist-search-docs',
            'hoist-list-docs',
            'hoist-read-doc',
            'hoist-search-symbols',
            'hoist-get-symbol',
            'hoist-get-members',
            'hoist-ping'
        ]);
        expect(tools.every(t => t.annotations?.readOnlyHint)).toBe(true);
        expect(tools[0].inputSchema.required).toEqual(['query']);
    });

    it('runs tools, with structured content', async () => {
        const res = await client.callTool({
            name: 'hoist-search-docs',
            arguments: {query: 'sortBy'}
        });
        expect(text(res)).toContain('matched "sortBy"');
        expect((res.structuredContent as any).resultCount).toBeGreaterThan(0);

        const ping = await client.callTool({name: 'hoist-ping', arguments: {}});
        expect(text(ping)).toContain('Versions: 90.0.0, 89.0.0');
    });

    it('scopes a call to one library and an older version', async () => {
        const core = await client.callTool({
            name: 'hoist-get-symbol',
            arguments: {name: 'BaseService', library: 'core'}
        });
        expect(text(core)).toContain('io.xh.hoist.BaseService');

        const old = await client.callTool({
            name: 'hoist-list-docs',
            arguments: {library: 'react', version: '89.0.0'}
        });
        expect((old.structuredContent as any).libraries).toEqual([
            {name: '@xh/hoist', version: '89.0.0', docCount: 4}
        ]);
    });

    it('reports bad arguments as tool errors', async () => {
        const missing = await client.callTool({name: 'hoist-search-docs', arguments: {}});
        expect(missing.isError).toBe(true);
        expect(text(missing)).toContain("required property 'query'");

        const noLibrary = await client.callTool({
            name: 'hoist-list-docs',
            arguments: {version: '89.0.0'}
        });
        expect(noLibrary.isError).toBe(true);

        const badVersion = await client.callTool({
            name: 'hoist-list-docs',
            arguments: {library: 'react', version: '1.0'}
        });
        expect(text(badVersion)).toContain("No index for react version '1.0'");
    });

    it('serves docs as resources', async () => {
        const {resources} = await client.listResources();
        expect(resources.map(r => r.uri)).toContain('hoist://docs/core:docs/caching.md');
        const res = await client.readResource({uri: 'hoist://docs/core:docs/caching.md'});
        expect((res.contents[0] as any).text).toContain('# Caching');
    });
});

describe('HTTP', () => {
    const post = (body: unknown, headers: Record<string, string> = {}) =>
        fetch(`${base}/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                ...headers
            },
            body: JSON.stringify(body)
        });

    it('answers a bare 2025-era initialize, as the simplest older clients send it', async () => {
        const res = await post({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-06-18',
                capabilities: {},
                clientInfo: {name: 'curl', version: '1'}
            }
        });
        expect(res.status).toBe(200);
        const body = res.headers.get('content-type')?.includes('event-stream')
            ? JSON.parse(/^data: (.*)$/m.exec(await res.text())![1])
            : await res.json();
        expect(body.result).toMatchObject({
            protocolVersion: '2025-06-18',
            serverInfo: {name: 'hoist-docs'}
        });
    });

    it('rejects browser requests from other origins, and allows local ones', async () => {
        const ping = {jsonrpc: '2.0', id: 1, method: 'ping'};
        expect((await post(ping, {Origin: 'https://evil.example'})).status).toBe(403);
        expect((await post(ping, {Origin: 'http://localhost:3000'})).status).not.toBe(403);
    });

    it('reports health, with the versions loaded', async () => {
        const health = await (await fetch(`${base}/health`)).json();
        expect(health).toEqual({
            name: 'hoist-docs',
            version: 'test',
            libraries: {react: ['90.0.0', '89.0.0'], core: ['40.0']}
        });
    });

    it('returns 404s as JSON, with no docs API', async () => {
        for (const path of ['/nope', '/docs/registry']) {
            const res = await fetch(`${base}${path}`);
            expect(res.status).toBe(404);
            expect(await res.json()).toEqual({name: 'NotFound', message: `No route for ${path}`});
        }
    });
});
