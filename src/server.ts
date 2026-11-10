/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * HTTP transport (`hoist-docs --http`), for MCP gateways and development. Routes:
 *
 * - `/mcp` - MCP Streamable HTTP, served by the SDK's `createMcpHandler`: the 2026-07-28 revision,
 *   and stateless serving of 2025-era traffic for older clients.
 * - `GET /health` - liveness, with the libraries and versions loaded.
 *
 * Everything is anonymous and read-only. Browser requests to `/mcp` are checked against allowed
 * origins (localhost plus `ALLOWED_ORIGINS`), against DNS rebinding; requests without an `Origin`
 * header, from agents and gateways, pass.
 */
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {Readable} from 'node:stream';

import {
    createMcpHandler,
    localhostAllowedOrigins,
    originValidationResponse,
    type McpHttpHandler
} from '@modelcontextprotocol/server';

import type {Config} from './config.ts';
import {NotFoundError, type IndexStore} from './IndexStore.ts';
import {errorData, log} from './log.ts';
import {createMcpServer} from './mcp.ts';

export function createApp(config: Config, store: IndexStore): Server {
    const mcp = createMcpHandler(() => createMcpServer(store, config), {
            onerror: e => log.warn('MCP request failed', errorData(e))
        }),
        allowedOrigins = [...localhostAllowedOrigins(), ...config.allowedOrigins];

    const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost'),
            path = url.pathname.replace(/\/+$/, '') || '/';
        try {
            if (path === '/mcp') return await serveMcp(mcp, allowedOrigins, req, res);

            if (req.method !== 'GET' && req.method !== 'HEAD') {
                return sendJson(
                    res,
                    405,
                    {name: 'MethodNotAllowed', message: 'Use GET'},
                    {Allow: 'GET'}
                );
            }
            if (path === '/health' || path === '/') {
                return sendJson(res, 200, {
                    name: 'hoist-docs',
                    version: config.version,
                    libraries: Object.fromEntries(
                        store.libraryIds().map(id => [id, store.versions(id)])
                    )
                });
            }
            return sendJson(res, 404, {name: 'NotFound', message: `No route for ${path}`});
        } catch (e) {
            if (e instanceof NotFoundError) {
                return sendJson(res, 404, {name: 'NotFound', message: e.message});
            }
            log.error('Request failed', {path, ...errorData(e)});
            if (!res.headersSent) {
                sendJson(res, 500, {name: 'Error', message: (e as Error)?.message ?? String(e)});
            }
        }
    });
    server.on('close', () => void mcp.close());
    return server;
}

/** Hand one request to the SDK's web-standard handler, and write back its response. */
async function serveMcp(
    mcp: McpHttpHandler,
    allowedOrigins: string[],
    req: IncomingMessage,
    res: ServerResponse
) {
    const request = toWebRequest(req),
        response = originValidationResponse(request, allowedOrigins) ?? (await mcp.fetch(request));

    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) {
        res.end();
        return;
    }
    // Streamed, since a response may upgrade to server-sent events.
    Readable.fromWeb(response.body as any).pipe(res);
}

function toWebRequest(req: IncomingMessage): Request {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) value.forEach(v => headers.append(name, v));
        else if (value != null) headers.set(name, value);
    }
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    return new Request(new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`), {
        method: req.method,
        headers,
        body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
        // Required by fetch for a streamed request body.
        ...(hasBody ? {duplex: 'half'} : {})
    } as RequestInit);
}

function sendJson(
    res: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {}
): void {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', ...headers}).end(
        JSON.stringify(body)
    );
}
