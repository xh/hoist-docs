/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * Structured logging: one JSON object per line, which log collectors can ingest as-is. Usage
 * tracking writes through the same channel with `msg: 'usage'`.
 *
 * Over HTTP, info and debug go to stdout and warnings and errors to stderr. Over stdio, stdout
 * carries the MCP protocol, so {@link logToStderr} sends everything to stderr, which agents show
 * as the server's log.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const DEBUG = process.env.LOG_LEVEL === 'debug';
let allToStderr = false;

/** Send every log line to stderr. Call before anything logs, when serving over stdio. */
export function logToStderr(): void {
    allToStderr = true;
}

function write(level: Level, msg: string, data?: Record<string, unknown>): void {
    if (level === 'debug' && !DEBUG) return;
    const line = JSON.stringify({time: new Date().toISOString(), level, msg, ...data});
    if (allToStderr || level === 'error' || level === 'warn') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
}

export const log = {
    debug: (msg: string, data?: Record<string, unknown>) => write('debug', msg, data),
    info: (msg: string, data?: Record<string, unknown>) => write('info', msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => write('warn', msg, data),
    error: (msg: string, data?: Record<string, unknown>) => write('error', msg, data)
};

/** Error details for a log line. */
export function errorData(e: unknown): Record<string, unknown> {
    return e instanceof Error ? {error: e.message, stack: e.stack} : {error: String(e)};
}
