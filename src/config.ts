/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/** Service configuration, from environment variables. See the Configuration table in docs/design.md. */
export interface Config {
    port: number;
    indexDir: string;
    logQueries: boolean;
    /**
     * Browser origins allowed to call the HTTP endpoint, besides localhost. Requests with no
     * `Origin` header (agents, gateways - anything but a browser) are always allowed.
     */
    allowedOrigins: string[];
    version: string;
}

export function loadConfig(
    env: Record<string, string | undefined> = process.env,
    version: string = 'dev'
): Config {
    return {
        port: parseInt(env.PORT ?? '') || 8081,
        indexDir: env.INDEX_DIR || 'indexes',
        logQueries: env.LOG_QUERIES === 'true',
        allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean),
        version
    };
}
