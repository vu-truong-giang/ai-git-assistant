export type AIErrorCode =
    | 'DISABLED'
    | 'MISSING_API_KEY'
    | 'INVALID_API_KEY'
    | 'MODEL_NOT_FOUND'
    | 'RATE_LIMITED'
    | 'TIMEOUT'
    | 'CANCELLED'
    | 'NETWORK'
    | 'CONTENT_BLOCKED'
    | 'INVALID_RESPONSE'
    | 'PROVIDER_ERROR';

/**
 * Provider-agnostic error. Every provider converts its own failures
 * (HTTP status, SDK exceptions, ...) into an AIError so the UI layer
 * only has to handle one error type.
 */
export class AIError extends Error {
    constructor(
        public readonly code: AIErrorCode,
        message: string,
        public readonly providerId: string,
        public readonly statusCode?: number,
        cause?: unknown
    ) {
        super(message, { cause });
        this.name = 'AIError';
    }

    /** Whether the same request could succeed if tried again later. */
    get isRetryable(): boolean {
        return this.code === 'RATE_LIMITED'
            || this.code === 'TIMEOUT'
            || this.code === 'NETWORK'
            || (this.code === 'PROVIDER_ERROR'
                && this.statusCode !== undefined
                && this.statusCode >= 500);
    }
}

export function isAIError(error: unknown): error is AIError {
    return error instanceof AIError;
}
