/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * MCP over stdio: the agent launches the tool and exchanges one JSON-RPC message per line on
 * stdin and stdout. Same handler as HTTP; only the framing differs. stdout carries nothing but
 * protocol messages, so logging must go to stderr (see `logToStderr`).
 */
import {createInterface} from 'node:readline';
import type {Readable, Writable} from 'node:stream';

import {errorData, log} from './log.ts';
import type {ClientInfo, McpHandler, RpcMessage} from './mcp.ts';

/** Serve MCP on a pair of streams until input ends. Resolves when it does. */
export function serveStdio(
    mcp: McpHandler,
    input: Readable = process.stdin,
    output: Writable = process.stdout
): Promise<void> {
    const lines = createInterface({input, crlfDelay: Infinity}),
        send = (msg: unknown) => output.write(JSON.stringify(msg) + '\n');
    let client: ClientInfo = {};

    lines.on('line', line => {
        if (!line.trim()) return;
        let msg: RpcMessage | null = null;
        try {
            const parsed = JSON.parse(line);
            if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed))
                msg = parsed;
        } catch {
            msg = null;
        }
        if (!msg) {
            send({
                jsonrpc: '2.0',
                id: null,
                error: {code: -32700, message: 'Parse error - expected a single JSON-RPC object'}
            });
            return;
        }

        if (msg.method === 'initialize') client = clientInfoOf(msg.params);
        try {
            const response = mcp.handle(msg, client);
            if (response) send(response);
        } catch (e) {
            log.error('Failed to handle stdio message', errorData(e));
        }
    });

    return new Promise(resolve => lines.on('close', resolve));
}

function clientInfoOf(params: unknown): ClientInfo {
    const info = (params as {clientInfo?: {name?: string; version?: string}})?.clientInfo ?? {};
    return {
        ...(info.name ? {name: info.name} : {}),
        ...(info.version ? {version: info.version} : {})
    };
}
