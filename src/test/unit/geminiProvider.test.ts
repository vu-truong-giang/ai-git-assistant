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

    it('detects blocked prompts and empty / truncated answers', async () => {
        const blocked = fakeFetch([json({ promptFeedback: { blockReason: 'SAFETY' } })]);
        await expectAIError(new GeminiProvider(key, blocked.fn).generate({ messages: [{ role: 'user', content: 'x' }] }), 'CONTENT_BLOCKED');

        const empty = fakeFetch([geminiAnswer('', 'MAX_TOKENS')]);
        await expectAIError(new GeminiProvider(key, empty.fn).generate({ messages: [{ role: 'user', content: 'x' }] }), 'INVALID_RESPONSE');

        const notJson = fakeFetch([new Response('<html>proxy error</html>', { status: 200 })]);
        await expectAIError(new GeminiProvider(key, notJson.fn).generate({ messages: [{ role: 'user', content: 'x' }] }), 'INVALID_RESPONSE');
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
