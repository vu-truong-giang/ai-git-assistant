import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { AIError } from '../../ai/models/AIError.model';
import { GeminiProvider } from '../../ai/providers/GeminiProvider';
import { fakeFetch, geminiAnswer, json } from './helpers';

const key = async () => 'AIza-test-key';

async function expectAIError(promise: Promise<unknown>, code: AIError['code']): Promise<AIError> {
    try {
        await promise;
    } catch (error) {
        assert.ok(error instanceof AIError, `expected AIError, got ${String(error)}`);
        assert.equal(error.code, code, error.message);
        return error;
    }
    assert.fail(`expected AIError ${code}`);
}

function sseResponse(events: unknown[]): Response {
    const data = events
        .map(event => `data: ${JSON.stringify(event)}\n\n`)
        .join('');

    return new Response(data, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
    });
}

function sseResponseFromChunks(chunks: string[]): Response {
    const encoder = new TextEncoder();

    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
        }
    });

    return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
    });
}

function responseFailingOnAbort(
    signal: AbortSignal | null | undefined,
    error: Error
): Response {
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            signal?.addEventListener('abort', () => controller.error(error), { once: true });
        }
    });

    return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
    });
}


describe('GeminiProvider (TASK 7.2)', () => {
    it('maps messages to Gemini format: system instruction, model role, merged turns, JSON mode', () => {
        const provider = new GeminiProvider(key);
        const body = provider.buildRequestBody({
            messages: [
                { role: 'system', content: 'rules A' },
                { role: 'system', content: 'rules B' },
                { role: 'user', content: 'q1' },
                { role: 'assistant', content: 'a1' },
                { role: 'user', content: 'q2' },
                { role: 'user', content: 'q2 more' }
            ],
            options: { temperature: 0.2, responseFormat: 'json' }
        });
        assert.deepEqual(body, {
            systemInstruction: { parts: [{ text: 'rules A\n\nrules B' }] },
            contents: [
                { role: 'user', parts: [{ text: 'q1' }] },
                { role: 'model', parts: [{ text: 'a1' }] },
                { role: 'user', parts: [{ text: 'q2' }, { text: 'q2 more' }] }
            ],
            generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
        });
    });

    it('sends the key in a header (not the URL) and parses text, model and usage', async () => {
        const stub = fakeFetch([geminiAnswer('Hello')]);
        const provider = new GeminiProvider(key, stub.fn, 'https://example.test/v1beta');
        const response = await provider.generate({
            messages: [{ role: 'user', content: 'hi' }],
            options: { model: 'gemini-x' }
        });

        assert.equal(response.text, 'Hello');
        assert.equal(response.model, 'gemini-test-001');
        assert.equal(response.finishReason, 'stop');
        assert.deepEqual(response.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
        assert.equal(stub.calls[0].url, 'https://example.test/v1beta/models/gemini-x:generateContent');
        assert.ok(!stub.calls[0].url.includes('AIza'));
        assert.equal((stub.calls[0].init.headers as Record<string, string>)['x-goog-api-key'], 'AIza-test-key');
    });

    it('ignores "thought" parts of thinking models', async () => {
        const stub = fakeFetch([json({
            candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: 'answer' }] }, finishReason: 'STOP' }]
        })]);
        const response = await new GeminiProvider(key, stub.fn).generate({ messages: [{ role: 'user', content: 'x' }] });
        assert.equal(response.text, 'answer');
    });

    it('reports a missing key without calling the network', async () => {
        const stub = fakeFetch([]);
        const provider = new GeminiProvider(async () => undefined, stub.fn);
        assert.equal(await provider.isConfigured(), false);
        await expectAIError(provider.generate({ messages: [{ role: 'user', content: 'x' }] }), 'MISSING_API_KEY');
        assert.equal(stub.calls.length, 0);
    });

    const httpCases: [number, unknown, AIError['code'], boolean][] = [
        [400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }, 'INVALID_API_KEY', false],
        [403, { error: { code: 403, message: 'Permission denied', status: 'PERMISSION_DENIED' } }, 'INVALID_API_KEY', false],
        [404, { error: { code: 404, message: 'models/foo is not found', status: 'NOT_FOUND' } }, 'MODEL_NOT_FOUND', false],
        [429, { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }, 'RATE_LIMITED', true],
        [503, { error: { code: 503, message: 'The model is overloaded', status: 'UNAVAILABLE' } }, 'PROVIDER_ERROR', true],
        [400, { error: { code: 400, message: 'Invalid JSON payload', status: 'INVALID_ARGUMENT' } }, 'PROVIDER_ERROR', false]
    ];
    for (const [status, body, code, retryable] of httpCases) {
        it(`maps HTTP ${status} to ${code} (TASK 7.5)`, async () => {
            const stub = fakeFetch([json(body, status)]);
            const error = await expectAIError(
                new GeminiProvider(key, stub.fn).generate({ messages: [{ role: 'user', content: 'x' }] }), code);
            assert.equal(error.statusCode, status);
            assert.equal(error.isRetryable, retryable);
        });
    }

    it('maps network failures to NETWORK', async () => {
        const stub = fakeFetch([new TypeError('fetch failed')]);
        await expectAIError(new GeminiProvider(key, stub.fn).generate({ messages: [{ role: 'user', content: 'x' }] }), 'NETWORK');
    });

    it('times out slow responses with TIMEOUT', async () => {
        const hang = (init: RequestInit) => new Promise<Response>((_, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
        const stub = fakeFetch([hang]);
        await expectAIError(new GeminiProvider(key, stub.fn).generate({
            messages: [{ role: 'user', content: 'x' }],
            options: { timeoutMs: 30 }
        }), 'TIMEOUT');
    });

    it('reports user cancellation as CANCELLED', async () => {
        const hang = (init: RequestInit) => new Promise<Response>((_, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
        const controller = new AbortController();
        const stub = fakeFetch([hang]);
        const pending = new GeminiProvider(key, stub.fn).generate({
            messages: [{ role: 'user', content: 'x' }],
            options: { signal: controller.signal, timeoutMs: 5000 }
        });
        setTimeout(() => controller.abort(), 10);
        await expectAIError(pending, 'CANCELLED');
    });

    it('prefers timeout and cancellation over AI errors while reading responses', async () => {
        const scenarios = [
            { expected: 'TIMEOUT' as const, timeoutMs: 25, cancel: false },
            { expected: 'CANCELLED' as const, timeoutMs: 5000, cancel: true }
        ];

        for (const scenario of scenarios) {
            const controller = new AbortController();
            const failure = new AIError('INVALID_RESPONSE', 'response read failed', 'gemini');
            const stub = fakeFetch([
                async init => responseFailingOnAbort(init.signal, failure)
            ]);
            const pending = new GeminiProvider(key, stub.fn).generate({
                messages: [{ role: 'user', content: 'x' }],
                options: {
                    timeoutMs: scenario.timeoutMs,
                    ...(scenario.cancel ? { signal: controller.signal } : {})
                }
            });

            if (scenario.cancel) {
                setTimeout(() => controller.abort(), 10);
            }

            await expectAIError(pending, scenario.expected);
        }
    });

    it('detects blocked prompts and empty / truncated answers', async () => {
        const blocked = fakeFetch([json({ promptFeedback: { blockReason: 'SAFETY' } })]);
        await expectAIError(new GeminiProvider(key, blocked.fn).generate({ messages: [{ role: 'user', content: 'x' }] }), 'CONTENT_BLOCKED');

        const empty = fakeFetch([geminiAnswer('', 'MAX_TOKENS')]);
        await expectAIError(new GeminiProvider(key, empty.fn).generate({ messages: [{ role: 'user', content: 'x' }] }), 'INVALID_RESPONSE');

        const notJson = fakeFetch([new Response('<html>proxy error</html>', { status: 200 })]);
        await expectAIError(new GeminiProvider(key, notJson.fn).generate({ messages: [{ role: 'user', content: 'x' }] }), 'INVALID_RESPONSE');
    });


    it('streams multiple chunks and returns the complete AIResponse', async () => {
        const stub = fakeFetch([
            sseResponse([
                {
                    candidates: [{
                        content: { parts: [{ text: 'Hello ' }] }
                    }]
                },
                {
                    candidates: [{
                        content: { parts: [{ text: 'World' }] },
                        finishReason: 'STOP'
                    }],
                    modelVersion: 'gemini-test-001',
                    usageMetadata: {
                        promptTokenCount: 10,
                        candidatesTokenCount: 5,
                        totalTokenCount: 15
                    }
                }
            ])
        ]);

        const provider = new GeminiProvider(
            key,
            stub.fn,
            'https://example.test/v1beta'
        );

        const chunks: string[] = [];

        const response = await provider.generateStream(
            {
                messages: [{ role: 'user', content: 'Say hello' }],
                options: { model: 'gemini-x' }
            },
            chunk => chunks.push(chunk)
        );

        assert.deepEqual(chunks, ['Hello ', 'World']);
        assert.equal(response.text, 'Hello World');
        assert.equal(response.model, 'gemini-test-001');
        assert.equal(response.finishReason, 'stop');

        assert.deepEqual(response.usage, {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15
        });

        assert.equal(
            stub.calls[0].url,
            'https://example.test/v1beta/models/gemini-x:streamGenerateContent?alt=sse'
        );

        const headers = stub.calls[0].init.headers as Record<string, string>;

        assert.equal(headers['x-goog-api-key'], 'AIza-test-key');
        assert.equal(headers['Accept'], 'text/event-stream');
    });

    
    it('ignores thought parts while streaming', async () => {
        const stub = fakeFetch([
            sseResponse([
                {
                    candidates: [{
                        content: {
                            parts: [
                                { text: 'Internal reasoning', thought: true },
                                { text: 'Actual answer' }
                            ]
                        },
                        finishReason: 'STOP'
                    }]
                }
            ])
        ]);

        const chunks: string[] = [];

        const response = await new GeminiProvider(key, stub.fn).generateStream(
            { messages: [{ role: 'user', content: 'Explain this' }] },
            chunk => chunks.push(chunk)
        );

        assert.deepEqual(chunks, ['Actual answer']);
        assert.equal(response.text, 'Actual answer');
    });


    it('handles SSE data split across multiple network chunks', async () => {
        const event = `data: ${JSON.stringify({
            candidates: [{
                content: { parts: [{ text: 'Split response' }] },
                finishReason: 'STOP'
            }]
        })}\n\n`;

        const splitAt = event.indexOf('"text"') + 4;

        const stub = fakeFetch([
            sseResponseFromChunks([
                event.slice(0, splitAt),
                event.slice(splitAt)
            ])
        ]);

        const chunks: string[] = [];

        const response = await new GeminiProvider(key, stub.fn).generateStream(
            { messages: [{ role: 'user', content: 'Test splitting' }] },
            chunk => chunks.push(chunk)
        );

        assert.equal(response.text, 'Split response');
        assert.deepEqual(chunks, ['Split response']);
    });


    it('rejects malformed SSE JSON with INVALID_RESPONSE', async () => {
        const stub = fakeFetch([
            new Response('data: {invalid-json}\n\n', {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' }
            })
        ]);

        await expectAIError(
            new GeminiProvider(key, stub.fn).generateStream(
                { messages: [{ role: 'user', content: 'Test malformed SSE' }] },
                () => {}
            ),
            'INVALID_RESPONSE'
        );
    });

    
    it('reports a missing API key for streaming without calling the network', async () => {
        const stub = fakeFetch([]);

        const provider = new GeminiProvider(
            async () => undefined,
            stub.fn
        );

        await expectAIError(
            provider.generateStream(
                { messages: [{ role: 'user', content: 'Hello' }] },
                () => {}
            ),
            'MISSING_API_KEY'
        );

        assert.equal(stub.calls.length, 0);
    });


    
    it('maps streaming HTTP 429 to RATE_LIMITED', async () => {
        const stub = fakeFetch([
            json({
                error: {
                    code: 429,
                    message: 'Quota exceeded',
                    status: 'RESOURCE_EXHAUSTED'
                }
            }, 429)
        ]);

        const error = await expectAIError(
            new GeminiProvider(key, stub.fn).generateStream(
                { messages: [{ role: 'user', content: 'Hello' }] },
                () => {}
            ),
            'RATE_LIMITED'
        );

        assert.equal(error.statusCode, 429);
    });

    it('reports cancellation while reading the streaming response', async () => {
        const hang = (init: RequestInit) => {
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    init.signal?.addEventListener('abort', () => {
                        controller.error(new DOMException('aborted', 'AbortError'));
                    }, { once: true });
                }
            });

            return Promise.resolve(new Response(body, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' }
            }));
        };

        const controller = new AbortController();
        const stub = fakeFetch([hang]);

        const pending = new GeminiProvider(key, stub.fn).generateStream(
            {
                messages: [{ role: 'user', content: 'Hello' }],
                options: {
                    signal: controller.signal,
                    timeoutMs: 5000
                }
            },
            () => {}
        );

        setTimeout(() => controller.abort(), 10);

        await expectAIError(pending, 'CANCELLED');
    });

    it('prefers timeout and cancellation over AI errors while reading streaming responses', async () => {
        const scenarios = [
            { expected: 'TIMEOUT' as const, timeoutMs: 25, cancel: false },
            { expected: 'CANCELLED' as const, timeoutMs: 5000, cancel: true }
        ];

        for (const scenario of scenarios) {
            const controller = new AbortController();
            const failure = new AIError('INVALID_RESPONSE', 'stream read failed', 'gemini');
            const stub = fakeFetch([
                async init => responseFailingOnAbort(init.signal, failure)
            ]);
            const pending = new GeminiProvider(key, stub.fn).generateStream(
                {
                    messages: [{ role: 'user', content: 'Hello' }],
                    options: {
                        timeoutMs: scenario.timeoutMs,
                        ...(scenario.cancel ? { signal: controller.signal } : {})
                    }
                },
                () => {}
            );

            if (scenario.cancel) {
                setTimeout(() => controller.abort(), 10);
            }

            await expectAIError(pending, scenario.expected);
        }
    });


    it('times out while reading the streaming response', async () => {
        const hang = (init: RequestInit) => {
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    init.signal?.addEventListener('abort', () => {
                        controller.error(new DOMException('aborted', 'AbortError'));
                    }, { once: true });
                }
            });

            return Promise.resolve(new Response(body, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' }
            }));
        };

        const stub = fakeFetch([hang]);

        await expectAIError(
            new GeminiProvider(key, stub.fn).generateStream(
                {
                    messages: [{ role: 'user', content: 'Hello' }],
                    options: { timeoutMs: 30 }
                },
                () => {}
            ),
            'TIMEOUT'
        );
    });

    

    it('lists only Gemini models that support generateContent', async () => {
        const stub = fakeFetch([json({
            models: [
                { name: 'models/gemini-b', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
                { name: 'models/gemini-a', supportedGenerationMethods: ['generateContent', 'countTokens'] }
            ]
        })]);
        assert.deepEqual(await new GeminiProvider(key, stub.fn).listModels(), ['gemini-a', 'gemini-b']);
    });
});
