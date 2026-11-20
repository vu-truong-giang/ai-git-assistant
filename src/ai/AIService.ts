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

    /** Random additional delay to prevent synchronized retries. */
    retryJitterMs?: number;

    /** Injectable random source, mainly for deterministic tests. */
    random?: () => number;

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
    private readonly retryJitterMs: number;
    private readonly random: () => number;
    private readonly log: (line: string) => void;

    constructor(
        private readonly provider: IAIProvider,
        private readonly getSettings: () => AIServiceSettings,
        options: AIServiceOptions = {}
    ) {
        this.maxRetries = Math.max(0, options.maxRetries ?? 2);
        this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 2000);
        this.retryJitterMs = Math.max(0, options.retryJitterMs ?? 500);
        this.random = options.random ?? Math.random;
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
        
        options: Omit<AIRequestOptions, 'model' | 'timeoutMs'> & {
            timeoutMs?: number;
            maxRetries?: number;
        } = {}
    ): Promise<AIResponse> {
        const settings = this.getSettings();
        if (!settings.enabled) {
            throw new AIError('DISABLED', 'AI features are turned off in settings.', this.provider.id);
        }
        if (!await this.provider.isConfigured()) {
            throw new AIError('MISSING_API_KEY', 'No API key has been set.', this.provider.id);
        }

        
const {
    maxRetries: requestMaxRetries,
    ...providerOptions
} = options;

const maxRetries = Math.max(0, requestMaxRetries ?? this.maxRetries);
const model = this.model;
const promptChars = messages.reduce(
    (sum, message) => sum + message.content.length,
    0
);

for (let attempt = 0; ; attempt++) {
    const started = Date.now();

    try {
        const response = await this.provider.generate({
            messages,
            options: {
                ...providerOptions,
                model,
                timeoutMs: providerOptions.timeoutMs ?? settings.timeoutMs
            }
        });

        const usage = response.usage
            ? `, tokens in/out ${response.usage.inputTokens}/${response.usage.outputTokens}`
            : '';

        this.log(
            `[${this.provider.id}] ${response.model} OK in ${Date.now() - started} ms ` +
            `(prompt ${promptChars} chars${usage})`
        );

        return response;
    } catch (error) {
        const aiError = error instanceof AIError
            ? error
            : new AIError(
                'PROVIDER_ERROR',
                String(error),
                this.provider.id,
                undefined,
                error
            );

        this.log(
            `[${this.provider.id}] ${model} failed after ${Date.now() - started} ms: ` +
            `${aiError.code} ${aiError.message}`
        );

        const transient = aiError.isRetryable && aiError.code !== 'TIMEOUT';

        if (
            !transient ||
            attempt >= maxRetries ||
            options.signal?.aborted
        ) {
            throw aiError;
        }

        const wait = calculateRetryDelay(
            this.retryDelayMs,
            attempt,
            this.retryJitterMs,
            this.random
        );

        this.log(
            `[${this.provider.id}] retrying in ${wait} ms ` +
            `(attempt ${attempt + 2}/${maxRetries + 1})`
        );

        try {
            await delay(wait, options.signal);
        } catch {
            throw new AIError(
                'CANCELLED',
                'The request was cancelled.',
                this.provider.id
            );
        }
    }
}

    }

    /**
     * Generates an AI response incrementally.
     * Preserves generate() for existing non-streaming features.
     */
    async generateStream(
        messages: AIMessage[],
        onChunk: (chunk: string) => void,
        options: Omit<AIRequestOptions, 'model' | 'timeoutMs'> & { timeoutMs?: number } = {}
    ): Promise<AIResponse> {
        const settings = this.getSettings();

        if (!settings.enabled) {
            throw new AIError(
                'DISABLED',
                'AI features are turned off in settings.',
                this.provider.id
            );
        }

        if (!await this.provider.isConfigured()) {
            throw new AIError(
                'MISSING_API_KEY',
                'No API key has been set.',
                this.provider.id
            );
        }

        if (!this.provider.generateStream) {
            throw new AIError(
                'PROVIDER_ERROR',
                'This AI provider does not support streaming.',
                this.provider.id
            );
        }

        const model = this.model;
        const promptChars = messages.reduce(
            (sum, message) => sum + message.content.length,
            0
        );

        for (let attempt = 0; ; attempt++) {
            const started = Date.now();
            let firstChunkAt: number | undefined;
            let chunkCount = 0;
            let emittedChunk = false;
            let callbackFailed = false;

            try {
                const response = await this.provider.generateStream(
                    {
                        messages,
                        options: {
                            ...options,
                            model,
                            timeoutMs: options.timeoutMs ?? settings.timeoutMs
                        }
                    },
                    (chunk: string) => {
                        try {
                            if (chunk.length > 0) {
                                emittedChunk = true;
                                chunkCount++;

                                if (firstChunkAt === undefined) {
                                    firstChunkAt = Date.now();

                                    this.log(
                                        `[${this.provider.id}] First chunk received after ${firstChunkAt - started} ms`
                                    );
                                }
                            }

                            onChunk(chunk);
                        } catch (error) {
                            callbackFailed = true;
                            throw error;
                        }
                    }
                );

                const usage = response.usage
                    ? `, tokens in/out ${response.usage.inputTokens}/${response.usage.outputTokens}`
                    : '';

               const totalDuration = Date.now() - started;
                const firstChunkDuration = firstChunkAt !== undefined
                    ? `${firstChunkAt - started} ms`
                    : 'No chunk received';

                this.log(
                    `[${this.provider.id}] ${response.model} STREAM OK | ` +
                    `total ${totalDuration} ms | ` +
                    `first chunk ${firstChunkDuration} | ` +
                    `chunks ${chunkCount} | ` +
                    `prompt ${promptChars} chars${usage}`
                );

                return response;
            } catch (error) {
                // Do not convert errors thrown by the consumer's callback.
                if (callbackFailed) {
                    throw error;
                }

                const aiError = error instanceof AIError
                    ? error
                    : new AIError(
                        'PROVIDER_ERROR',
                        String(error),
                        this.provider.id,
                        undefined,
                        error
                    );

                const totalDuration = Date.now() - started;

                const firstChunkDuration =
                    firstChunkAt !== undefined
                        ? `${firstChunkAt - started} ms`
                        : 'Not received';

                this.log(
                    `[${this.provider.id}] ${model} STREAM FAILED` +
                    ` | total ${totalDuration} ms` +
                    ` | first chunk ${firstChunkDuration}` +
                    ` | chunks ${chunkCount}` +
                    ` | error ${aiError.code}: ${aiError.message}`
                );
                const transient =
                    aiError.isRetryable && aiError.code !== 'TIMEOUT';

                // Never retry after sending partial content to the UI.
                // Otherwise the user could receive duplicated chunks.
                if (
                    !transient ||
                    emittedChunk ||
                    attempt >= this.maxRetries ||
                    options.signal?.aborted
                ) {
                    throw aiError;
                }

                const wait = calculateRetryDelay(
                    this.retryDelayMs,
                    attempt,
                    this.retryJitterMs,
                    this.random
                );

                this.log(
                    `[${this.provider.id}] STREAM retrying in ${wait} ms (attempt ${attempt + 2}/${this.maxRetries + 1})`
                );

                try {
                    await delay(wait, options.signal);
                } catch {
                    throw new AIError(
                        'CANCELLED',
                        'The request was cancelled.',
                        this.provider.id
                    );
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
function calculateRetryDelay(
    baseDelayMs: number,
    attempt: number,
    jitterMs: number,
    random: () => number
): number {
    const exponentialDelay = baseDelayMs * 2 ** attempt;

    // Clamp random value to [0, 1).
    const randomValue = Math.min(
        Math.max(random(), 0),
        1 - Number.EPSILON
    );

    const jitter = Math.floor(randomValue * (jitterMs + 1));

    return exponentialDelay + jitter;
}
