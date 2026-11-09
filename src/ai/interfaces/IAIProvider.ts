import { AIRequest } from '../models/AIRequest.model';
import { AIResponse } from '../models/AIResponse.model';

/**
 * Contract every AI backend (Gemini, OpenAI, ...) must implement.
 * Features such as commit message generation or diff explanation
 * depend only on this interface, never on a concrete provider.
 */
export interface IAIProvider {
    /** Stable identifier, e.g. 'gemini'. */
    readonly id: string;

    /** Human-readable name shown in the UI, e.g. 'Google Gemini'. */
    readonly displayName: string;

    /** Model used when a request does not name one. */
    readonly defaultModel: string;

    /** True when the provider has everything it needs (e.g. an API key) to send requests. */
    isConfigured(): Promise<boolean>;

    /**
     * Sends the request and returns the full response.
     * @throws {AIError} for any failure (missing key, timeout, HTTP error, ...).
     */
    generate(request: AIRequest): Promise<AIResponse>;

    /** Model ids usable with generate(), when the backend can list them. */
    listModels?(signal?: AbortSignal): Promise<string[]>;
}
