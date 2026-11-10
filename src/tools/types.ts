/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/** What a tool returns: text for the agent, plus structured content or an error flag. */
export interface ToolOutput {
    text: string;
    structured?: Record<string, unknown>;
    isError?: boolean;
}
