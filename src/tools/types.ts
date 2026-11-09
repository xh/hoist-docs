/** What a tool returns: text for the agent, plus structured content or an error flag. */
export interface ToolOutput {
    text: string;
    structured?: Record<string, unknown>;
    isError?: boolean;
}
