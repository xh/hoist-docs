/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import type {AddressInfo} from 'node:net';
import type {Server} from 'node:http';

import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {loadConfig} from '../src/config.ts';
import {IndexStore} from '../src/IndexStore.ts';
import {LATEST_PROTOCOL, McpHandler} from '../src/mcp.ts';
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

describe('McpHandler', () => {
    const mcp = new McpHandler(store, config),
        call = (name: string, args: object = {}) =>
            mcp.handle({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: {name, arguments: args}
            }) as {
                result: {
                    content: Array<{text: string}>;
                    isError?: boolean;
                    structuredContent?: Record<string, unknown>;
                };
            };

    it('negotiates the protocol version', () => {
        const init = (v: string) =>
            (
                mcp.handle({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {protocolVersion: v}
                }) as {
                    result: {protocolVersion: string};
                }
            ).result.protocolVersion;
        expect(init('2025-06-18')).toBe('2025-06-18');
        expect(init('1999-01-01')).toBe(LATEST_PROTOCOL);

        const discover = mcp.handle({jsonrpc: '2.0', id: 2, method: 'server/discover'}) as {
            result: Record<string, unknown>;
        };
        expect(discover.result.supportedVersions).toContain(LATEST_PROTOCOL);
        expect(discover.result.instructions).toContain('react (@xh/hoist 90.0.0)');
    });

    it('answers notifications with nothing and reports protocol errors', () => {
        expect(mcp.handle({jsonrpc: '2.0', method: 'notifications/initialized'})).toBeNull();
        expect(mcp.handle({jsonrpc: '2.0', id: 3, method: 'nope'})).toMatchObject({
            error: {code: -32601}
        });
        expect(mcp.handle({id: 4, method: 'ping'})).toMatchObject({error: {code: -32600}});
        expect(call('hoist-search-docs', {})).toMatchObject({
            error: {code: -32602, message: 'Missing required argument: query'}
        });
        expect(call('hoist-nope')).toMatchObject({error: {code: -32602}});
    });

    it('lists seven read-only tools', () => {
        const res = mcp.handle({jsonrpc: '2.0', id: 1, method: 'tools/list'}) as {
            result: {tools: Array<{name: string; annotations: {readOnlyHint: boolean}}>};
        };
        expect(res.result.tools.map(t => t.name)).toEqual([
            'hoist-search-docs',
            'hoist-list-docs',
            'hoist-read-doc',
            'hoist-search-symbols',
            'hoist-get-symbol',
            'hoist-get-members',
            'hoist-ping'
        ]);
        expect(res.result.tools.every(t => t.annotations.readOnlyHint)).toBe(true);
    });

    it('runs tools, with structured content', () => {
        const res = call('hoist-search-docs', {query: 'sortBy'});
        expect(res.result.content[0].text).toContain('matched "sortBy"');
        expect(res.result.structuredContent?.resultCount).toBeGreaterThan(0);
        expect(call('hoist-ping').result.content[0].text).toContain('Versions: 90.0.0, 89.0.0');
    });

    it('scopes hoist-core-* aliases to hoist-core', () => {
        const res = call('hoist-core-search-docs', {query: 'grid sort'});
        expect(res.result.content[0].text).not.toContain('cmp/grid');
        expect(
            call('hoist-core-get-symbol', {name: 'BaseService'}).result.content[0].text
        ).toContain('io.xh.hoist.BaseService');
    });

    it('queries an older version, and reports bad library and version as tool errors', () => {
        const res = call('hoist-list-docs', {library: 'react', version: '89.0.0'});
        expect(res.result.structuredContent?.libraries).toEqual([
            {name: '@xh/hoist', version: '89.0.0', docCount: 4}
        ]);
        expect(call('hoist-list-docs', {version: '89.0.0'}).result).toMatchObject({isError: true});
        expect(
            call('hoist-list-docs', {library: 'react', version: '1.0'}).result.content[0].text
        ).toContain("No index for react version '1.0'");
    });

    it('serves docs as resources', () => {
        const res = mcp.handle({
            jsonrpc: '2.0',
            id: 1,
            method: 'resources/read',
            params: {uri: 'hoist://docs/core:docs/caching.md'}
        }) as {result: {contents: Array<{text: string}>}};
        expect(res.result.contents[0].text).toContain('# Caching');
    });
});

describe('HTTP', () => {
    let server: Server, base: string;

    beforeAll(async () => {
        server = createApp(config, store);
        await new Promise<void>(resolve => server.listen(0, resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

    const post = (body: string) => fetch(`${base}/mcp`, {method: 'POST', body});

    it('serves MCP over POST only', async () => {
        const ok = await post(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'ping'}));
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({jsonrpc: '2.0', id: 1, result: {}});

        expect(
            (await post(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'})))
                .status
        ).toBe(202);
        expect((await post('not json')).status).toBe(400);
        expect((await post('[]')).status).toBe(400);
        expect((await fetch(`${base}/mcp`)).status).toBe(405);
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
