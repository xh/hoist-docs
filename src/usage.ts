import {log} from './log.ts';

/** One usage record: an MCP tool call or a docs API search. */
export interface Usage {
    category: 'MCP' | 'Docs';
    /** Tool name or API action. */
    action: string;
    elapsedMs: number;
    [key: string]: unknown;
}

/** Write a usage record as a structured log line, `msg: 'usage'`, for log-based reporting. */
export function trackUsage(usage: Usage): void {
    log.info('usage', usage);
}
