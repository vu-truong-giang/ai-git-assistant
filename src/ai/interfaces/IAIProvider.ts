
import type { AIRequest } from '../models/AIRequest.model';
import type { AIResponse } from '../models/AIResponse.model';

/**
 * Contract every AI backend (Gemini, OpenAI, ...)
 * must implement.
 *
 * Features depend on this interface, never on
 * a concrete provider implementation.
 */
export interface IAIProvider {
    /** Stable identifier, e.g. 'gemini'. */
    readonly id: string;

    /** Human-readable name shown in the UI. */
    readonly displayName: string;

    /** Default model used when request does not specify one. */
    readonly defaultModel: string;

    /** Checks whether the provider is ready to send requests. */
    isConfigured(): Promise<boolean>;

    /**
     * Sends a request and returns the complete response.
     *
     * @throws AIError for provider failures.
     */
    generate(request: AIRequest): Promise<AIResponse>;

    /**
     * Sends a request and emits generated text incrementally.
     *
     * The callback receives text chunks in generation order.
     * The returned promise resolves with the complete response.
     *
     * The request's AbortSignal must cancel the streaming operation.
     *
     * Optional: providers without streaming support can omit this method.
     *
     * @param request AI request and generation options.
     * @param onChunk Callback invoked whenever new text is available.
     * @returns Complete AI response after the stream finishes.
     */
    generateStream?(
        request: AIRequest,
        onChunk: (chunk: string) => void
    ): Promise<AIResponse>;

    /**
     * Returns model IDs supported by this provider.
     */
    listModels?(signal?: AbortSignal): Promise<string[]>;
}
