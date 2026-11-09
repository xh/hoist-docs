/**
 * Structured logging: one JSON object per line on stdout, which log collectors (hosted or
 * on-prem) can ingest as-is. Usage tracking writes through the same channel with `msg: 'usage'`.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const DEBUG = process.env.LOG_LEVEL === 'debug';

function write(level: Level, msg: string, data?: Record<string, unknown>): void {
    if (level === 'debug' && !DEBUG) return;
    const line = JSON.stringify({time: new Date().toISOString(), level, msg, ...data});
    if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
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
