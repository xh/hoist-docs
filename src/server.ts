/**
 * HTTP entry point. Routes:
 *
 * - `POST /mcp` - MCP Streamable HTTP endpoint (stateless JSON-RPC, see `mcp.ts`).
 * - `GET /docs/registry`, `/docs/content`, `/docs/search` - public docs API (see `docs-api.ts`).
 * - `GET /health` - liveness, with the libraries and versions loaded.
 *
 * Everything is anonymous and read-only.
 */
import {readFileSync} from 'node:fs';
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';

import {loadConfig, type Config} from './config.ts';
import {DocsApi} from './docs-api.ts';
import {IndexStore, NotFoundError} from './IndexStore.ts';
import {errorData, log} from './log.ts';
import {McpHandler, type RpcMessage} from './mcp.ts';

/** Largest request body accepted, in bytes. MCP requests are small. */
const MAX_BODY_BYTES = 1_000_000;

export function createApp(config: Config, store: IndexStore): Server {
    const mcp = new McpHandler(store, config),
        docs = new DocsApi(store, config);

    return createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost'),
            path = url.pathname.replace(/\/+$/, '') || '/';
        try {
            if (path === '/mcp') return await handleMcp(mcp, req, res);

            if (req.method !== 'GET' && req.method !== 'HEAD') {
                return sendJson(
                    res,
                    405,
                    {name: 'MethodNotAllowed', message: 'Use GET'},
                    {Allow: 'GET'}
                );
            }
            switch (path) {
                case '/docs/registry':
                    return sendJson(res, 200, docs.registry(url.searchParams));
                case '/docs/content':
                    return sendJson(res, 200, docs.content(url.searchParams));
                case '/docs/search':
                    return sendJson(
                        res,
                        200,
                        docs.search(url.searchParams, req.headers['user-agent'])
                    );
                case '/health':
                case '/':
                    return sendJson(res, 200, {
                        name: 'hoist-docs',
                        version: config.version,
                        libraries: Object.fromEntries(
                            store.libraryIds().map(id => [id, store.versions(id)])
                        )
                    });
                default:
                    return sendJson(res, 404, {name: 'NotFound', message: `No route for ${path}`});
            }
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
}

async function handleMcp(mcp: McpHandler, req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') {
        res.writeHead(405, {Allow: 'POST'}).end();
        return;
    }

    let msg: RpcMessage | null = null;
    try {
        const parsed = JSON.parse(await readBody(req));
        if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) msg = parsed;
    } catch {
        msg = null;
    }
    if (!msg) {
        return sendJson(res, 400, {
            jsonrpc: '2.0',
            id: null,
            error: {code: -32700, message: 'Parse error - expected a single JSON-RPC object'}
        });
    }

    const params = (msg.params ?? {}) as {_meta?: {clientInfo?: unknown}; clientInfo?: unknown},
        client = (params._meta?.clientInfo ?? params.clientInfo ?? {}) as {
            name?: string;
            version?: string;
        },
        response = mcp.handle(msg, {
            ...(client.name ? {name: client.name} : {}),
            ...(client.version ? {version: client.version} : {}),
            ...(req.headers['user-agent'] ? {userAgent: req.headers['user-agent']} : {})
        });

    if (response == null) {
        res.writeHead(202).end();
    } else {
        sendJson(res, 200, response);
    }
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('Request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
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

//------------------------
// Main
//------------------------
if (import.meta.main) {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')),
        config = loadConfig(process.env, pkg.version),
        store = new IndexStore(config.indexDir);

    store.init();
    createApp(config, store).listen(config.port, () => {
        log.info('Hoist Docs started', {
            port: config.port,
            indexDir: store.dir,
            version: config.version
        });
    });
}
