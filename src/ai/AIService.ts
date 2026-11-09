import { IAIProvider } from './interfaces/IAIProvider';
import { AIError } from './models/AIError.model';
import { AIMessage, AIRequestOptions } from './models/AIRequest.model';
import { AIResponse } from './models/AIResponse.model';
import { delay } from './utils/abort';

export interface AIServiceSettings {
    enabled: boolean;
    /** Empty string means "use the provider default". */
    model: string;
    timeoutMs: number;
}

export interface AIServiceOptions {
    /** Extra attempts for transient failures (rate limit, network, 5xx). */
    maxRetries?: number;
    /** Base delay of the exponential backoff between retries. */
    retryDelayMs?: number;
    log?: (line: string) => void;
}

export interface ConnectionTestResult {
    provider: string;
    model: string;
    latencyMs: number;
    reply: string;
}

/**
 * Single entry point the features use to talk to the AI.
 * Applies settings (enabled, model, timeout), retries transient failures,
 * and logs timing/token usage. Has no VS Code dependency so it can be unit tested.
 */
export class AIService {
    private readonly maxRetries: number;
    private readonly retryDelayMs: number;
    private readonly log: (line: string) => void;

    constructor(
        private readonly provider: IAIProvider,
        private readonly getSettings: () => AIServiceSettings,
        options: AIServiceOptions = {}
    ) {
        this.maxRetries = options.maxRetries ?? 2;
        this.retryDelayMs = options.retryDelayMs ?? 1500;
        this.log = options.log ?? (() => undefined);
    }

    get providerId(): string {
        return this.provider.id;
    }

    get providerName(): string {
        return this.provider.displayName;
    }

    get model(): string {
        return this.getSettings().model.trim() || this.provider.defaultModel;
    }

    isEnabled(): boolean {
        return this.getSettings().enabled;
    }

    isConfigured(): Promise<boolean> {
        return this.provider.isConfigured();
    }

    async generate(
        messages: AIMessage[],
        options: Omit<AIRequestOptions, 'model' | 'timeoutMs'> & { timeoutMs?: number } = {}
    ): Promise<AIResponse> {
        const settings = this.getSettings();
        if (!settings.enabled) {
            throw new AIError('DISABLED', 'AI features are turned off in settings.', this.provider.id);
        }
        if (!await this.provider.isConfigured()) {
            throw new AIError('MISSING_API_KEY', 'No API key has been set.', this.provider.id);
        }

        const model = this.model;
        const promptChars = messages.reduce((sum, message) => sum + message.content.length, 0);

        for (let attempt = 0; ; attempt++) {
            const started = Date.now();
            try {
                const response = await this.provider.generate({
                    messages,
                    options: { ...options, model, timeoutMs: options.timeoutMs ?? settings.timeoutMs }
                });
                const usage = response.usage
                    ? `, tokens in/out ${response.usage.inputTokens}/${response.usage.outputTokens}`
                    : '';
                this.log(`[${this.provider.id}] ${response.model} OK in ${Date.now() - started} ms (prompt ${promptChars} chars${usage})`);
                return response;
            } catch (error) {
                const aiError = error instanceof AIError
                    ? error
                    : new AIError('PROVIDER_ERROR', String(error), this.provider.id, undefined, error);
                this.log(`[${this.provider.id}] ${model} failed after ${Date.now() - started} ms: ${aiError.code} ${aiError.message}`);

                // Timeouts are not retried automatically: the user already waited the full timeout.
                const transient = aiError.isRetryable && aiError.code !== 'TIMEOUT';
                if (!transient || attempt >= this.maxRetries || options.signal?.aborted) {
                    throw aiError;
                }
                const wait = this.retryDelayMs * 2 ** attempt;
                this.log(`[${this.provider.id}] retrying in ${wait} ms (attempt ${attempt + 2}/${this.maxRetries + 1})`);
                try {
                    await delay(wait, options.signal);
                } catch {
                    throw new AIError('CANCELLED', 'The request was cancelled.', this.provider.id);
                }
            }
        }
    }

    /** Sends a tiny prompt to verify the key, model and network all work. */
    async testConnection(signal?: AbortSignal): Promise<ConnectionTestResult> {
        const started = Date.now();
        const response = await this.generate([
            { role: 'user', content: 'Reply with exactly the word: OK' }
        ], { signal, temperature: 0 });
        return {
            provider: this.provider.displayName,
            model: response.model,
            latencyMs: Date.now() - started,
            reply: response.text.trim()
        };
    }

    async listModels(signal?: AbortSignal): Promise<string[]> {
        return this.provider.listModels ? this.provider.listModels(signal) : [];
    }
}
