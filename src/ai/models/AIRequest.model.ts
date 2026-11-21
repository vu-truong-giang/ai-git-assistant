export type AIMessageRole = 'system' | 'user' | 'assistant';

export interface AIMessage {
    role: AIMessageRole;
    content: string;
}

export interface AIRequestOptions {
    /** Model override; falls back to the provider's configured default. */
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
    /** 'json' asks the provider to return a single JSON document. */
    responseFormat?: 'text' | 'json';
    /** Request timeout in milliseconds. */
    timeoutMs?: number;
    /** Lets the caller cancel an in-flight request (e.g. from a VS Code CancellationToken). */
    signal?: AbortSignal;
}

export interface AIRequest {
    messages: AIMessage[];
    options?: AIRequestOptions;
}
