import { IAIProvider } from '../../ai/interfaces/IAIProvider';
import { AIRequest } from '../../ai/models/AIRequest.model';
import { AIResponse } from '../../ai/models/AIResponse.model';

/** Provider that records requests and answers from a queue (string or Error). */
export class FakeProvider implements IAIProvider {
    readonly id = 'fake';
    readonly displayName = 'Fake AI';
    readonly defaultModel = 'fake-model';
    readonly requests: AIRequest[] = [];

    constructor(private readonly answers: (string | Error)[], private configured = true) {}

    async isConfigured(): Promise<boolean> {
        return this.configured;
    }

    async generate(request: AIRequest): Promise<AIResponse> {
        this.requests.push(request);
        const next = this.answers.shift();
        if (next === undefined) {
            throw new Error('FakeProvider: no more answers queued');
        }
        if (next instanceof Error) {
            throw next;
        }
        return { text: next, model: request.options?.model ?? this.defaultModel, finishReason: 'stop' };
    }
}

export type FetchCall = { url: string; init: RequestInit };

/** fetch stub: each call returns the next queued response (or throws it). */
export function fakeFetch(responses: (Response | Error | ((init: RequestInit) => Promise<Response>))[]) {
    const calls: FetchCall[] = [];
    const fn = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
        calls.push({ url: String(input), init });
        const next = responses.shift();
        if (!next) {
            throw new Error('fakeFetch: no more responses queued');
        }
        if (next instanceof Error) {
            throw next;
        }
        if (typeof next === 'function') {
            return next(init);
        }
        return next;
    };
    return { fn: fn as typeof fetch, calls };
}

export function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function geminiAnswer(text: string, finishReason = 'STOP'): Response {
    return json({
        candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        modelVersion: 'gemini-test-001'
    });
}
