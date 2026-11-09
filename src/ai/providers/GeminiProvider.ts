import { IAIProvider } from '../interfaces/IAIProvider';
import { AIError, AIErrorCode } from '../models/AIError.model';
import { AIMessage, AIRequest } from '../models/AIRequest.model';
import { AIFinishReason, AIResponse } from '../models/AIResponse.model';
import { createLinkedSignal } from '../utils/abort';

export const GEMINI_DEFAULT_MODEL = 'gemini-flash-latest';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TIMEOUT_MS = 60_000;

type FetchFn = typeof fetch;

interface GeminiPart {
    text?: string;
    thought?: boolean;
}

interface GeminiContent {
    role: 'user' | 'model';
    parts: GeminiPart[];
}

interface GeminiGenerateResponse {
    candidates?: {
        content?: { parts?: GeminiPart[] };
        finishReason?: string;
    }[];
    promptFeedback?: { blockReason?: string };
    usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
    };
    modelVersion?: string;
}

interface GeminiErrorBody {
    error?: { code?: number; message?: string; status?: string };
}

/**
 * Google Gemini via the public REST API (no SDK dependency).
 * Docs: https://ai.google.dev/api/generate-content
 */
export class GeminiProvider implements IAIProvider {
    readonly id = 'gemini';
    readonly displayName = 'Google Gemini';
    readonly defaultModel = GEMINI_DEFAULT_MODEL;

    constructor(
        private readonly getApiKey: () => Promise<string | undefined>,
        private readonly fetchFn: FetchFn = (...args) => fetch(...args),
        private readonly baseUrl = GEMINI_BASE_URL
    ) {}

    async isConfigured(): Promise<boolean> {
        return Boolean((await this.getApiKey())?.trim());
    }

    async generate(request: AIRequest): Promise<AIResponse> {
        const options = request.options ?? {};
        const model = options.model?.trim() || this.defaultModel;
        const body = this.buildRequestBody(request);
        const url = `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`;

        const json = await this.send<GeminiGenerateResponse>(url, {
            method: 'POST',
            body: JSON.stringify(body)
        }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.signal);

        return this.parseResponse(json, model);
    }

    async listModels(signal?: AbortSignal): Promise<string[]> {
        const json = await this.send<{
            models?: { name?: string; supportedGenerationMethods?: string[] }[];
        }>(`${this.baseUrl}/models?pageSize=1000`, { method: 'GET' }, DEFAULT_TIMEOUT_MS, signal);

        return (json.models ?? [])
            .filter(model => model.supportedGenerationMethods?.includes('generateContent'))
            .map(model => (model.name ?? '').replace(/^models\//, ''))
            .filter(name => name.startsWith('gemini'))
            .sort();
    }

    /** Exposed for unit tests. */
    buildRequestBody(request: AIRequest): Record<string, unknown> {
        const options = request.options ?? {};
        const systemText = request.messages
            .filter(message => message.role === 'system')
            .map(message => message.content)
            .join('\n\n');
        const contents = toGeminiContents(
            request.messages.filter(message => message.role !== 'system')
        );
        if (contents.length === 0) {
            throw new AIError('INVALID_RESPONSE', 'The request has no user message.', this.id);
        }

        const generationConfig: Record<string, unknown> = {};
        if (options.temperature !== undefined) {
            generationConfig.temperature = options.temperature;
        }
        if (options.maxOutputTokens !== undefined) {
            generationConfig.maxOutputTokens = options.maxOutputTokens;
        }
        if (options.responseFormat === 'json') {
            generationConfig.responseMimeType = 'application/json';
        }

        return {
            ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
            contents,
            ...(Object.keys(generationConfig).length ? { generationConfig } : {})
        };
    }

    private async send<T>(
        url: string,
        init: { method: string; body?: string },
        timeoutMs: number,
        signal?: AbortSignal
    ): Promise<T> {
        const apiKey = (await this.getApiKey())?.trim();
        if (!apiKey) {
            throw new AIError('MISSING_API_KEY', 'Gemini API key is not set.', this.id);
        }

        const linked = createLinkedSignal(timeoutMs, signal);
        let response: Response;
        try {
            response = await this.fetchFn(url, {
                ...init,
                headers: {
                    'Content-Type': 'application/json',
                    // Header instead of ?key= so the key never ends up in URLs or logs.
                    'x-goog-api-key': apiKey
                },
                signal: linked.signal
            });
        } catch (error) {
            linked.dispose();
            if (linked.timedOut()) {
                throw new AIError('TIMEOUT', `Gemini did not respond within ${Math.round(timeoutMs / 1000)}s.`, this.id, undefined, error);
            }
            if (linked.signal.aborted) {
                throw new AIError('CANCELLED', 'The request was cancelled.', this.id, undefined, error);
            }
            throw new AIError('NETWORK', `Cannot reach Gemini: ${describe(error)}`, this.id, undefined, error);
        }

        try {
            const text = await response.text();
            if (!response.ok) {
                throw this.toHttpError(response.status, text);
            }
            try {
                return JSON.parse(text) as T;
            } catch (error) {
                throw new AIError('INVALID_RESPONSE', 'Gemini returned a response that is not JSON.', this.id, response.status, error);
            }
        } catch (error) {
            if (error instanceof AIError) {
                throw error;
            }
            if (linked.timedOut()) {
                throw new AIError('TIMEOUT', `Gemini did not respond within ${Math.round(timeoutMs / 1000)}s.`, this.id, undefined, error);
            }
            if (linked.signal.aborted) {
                throw new AIError('CANCELLED', 'The request was cancelled.', this.id, undefined, error);
            }
            throw new AIError('NETWORK', `Connection to Gemini failed: ${describe(error)}`, this.id, undefined, error);
        } finally {
            linked.dispose();
        }
    }

    private toHttpError(status: number, bodyText: string): AIError {
        let detail = bodyText.slice(0, 500);
        let apiStatus = '';
        try {
            const body = JSON.parse(bodyText) as GeminiErrorBody;
            detail = body.error?.message ?? detail;
            apiStatus = body.error?.status ?? '';
        } catch {
            // Keep the raw text.
        }

        let code: AIErrorCode = 'PROVIDER_ERROR';
        if (status === 401 || status === 403 || /api key not valid|API_KEY_INVALID/i.test(detail)) {
            code = 'INVALID_API_KEY';
        } else if (status === 404) {
            code = 'MODEL_NOT_FOUND';
        } else if (status === 429 || apiStatus === 'RESOURCE_EXHAUSTED') {
            code = 'RATE_LIMITED';
        }
        return new AIError(code, `Gemini ${status}${apiStatus ? ` ${apiStatus}` : ''}: ${detail}`, this.id, status);
    }

    private parseResponse(json: GeminiGenerateResponse, requestedModel: string): AIResponse {
        const blockReason = json.promptFeedback?.blockReason;
        const candidate = json.candidates?.[0];
        if (!candidate) {
            if (blockReason) {
                throw new AIError('CONTENT_BLOCKED', `Gemini blocked the request (${blockReason}).`, this.id);
            }
            throw new AIError('INVALID_RESPONSE', 'Gemini returned no answer.', this.id);
        }

        const text = (candidate.content?.parts ?? [])
            .filter(part => !part.thought && typeof part.text === 'string')
            .map(part => part.text)
            .join('');
        const finishReason = mapFinishReason(candidate.finishReason);

        if (!text.trim()) {
            if (finishReason === 'safety') {
                throw new AIError('CONTENT_BLOCKED', `Gemini stopped the answer (${candidate.finishReason}).`, this.id);
            }
            if (finishReason === 'length') {
                throw new AIError('INVALID_RESPONSE', 'Gemini ran out of output tokens before answering.', this.id);
            }
            throw new AIError('INVALID_RESPONSE', 'Gemini returned an empty answer.', this.id);
        }

        const usage = json.usageMetadata;
        return {
            text,
            model: json.modelVersion ?? requestedModel,
            finishReason,
            usage: usage
                ? {
                    inputTokens: usage.promptTokenCount ?? 0,
                    outputTokens: usage.candidatesTokenCount ?? 0,
                    totalTokens: usage.totalTokenCount ?? 0
                }
                : undefined
        };
    }
}

/** Gemini needs user/model roles and rejects back-to-back turns of the same role. */
function toGeminiContents(messages: AIMessage[]): GeminiContent[] {
    const contents: GeminiContent[] = [];
    for (const message of messages) {
        const role = message.role === 'assistant' ? 'model' : 'user';
        const last = contents[contents.length - 1];
        if (last?.role === role) {
            last.parts.push({ text: message.content });
        } else {
            contents.push({ role, parts: [{ text: message.content }] });
        }
    }
    return contents;
}

function mapFinishReason(reason: string | undefined): AIFinishReason {
    switch (reason) {
        case 'STOP':
            return 'stop';
        case 'MAX_TOKENS':
            return 'length';
        case 'SAFETY':
        case 'RECITATION':
        case 'BLOCKLIST':
        case 'PROHIBITED_CONTENT':
        case 'SPII':
            return 'safety';
        default:
            return 'other';
    }
}

function describe(error: unknown): string {
    if (error instanceof Error) {
        const cause = (error as Error & { cause?: unknown }).cause;
        return cause instanceof Error ? `${error.message} (${cause.message})` : error.message;
    }
    return String(error);
}
