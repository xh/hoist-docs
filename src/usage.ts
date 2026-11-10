import {log} from './log.ts';

/** One usage record: an MCP tool call. */
export interface Usage {
    category: 'MCP';
    /** Tool name or API action. */
    action: string;
    elapsedMs: number;
    [key: string]: unknown;
}

/** Write a usage record as a structured log line, `msg: 'usage'`, for log-based reporting. */
export function trackUsage(usage: Usage): void {
    log.info('usage', usage);
}
