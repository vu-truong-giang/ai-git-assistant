import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { AIService, AIServiceSettings } from '../../ai/AIService';
import { describeAIError } from '../../ai/errorMessages';
import { AIError } from '../../ai/models/AIError.model';
import { FakeProvider } from './helpers';

const settings = (overrides: Partial<AIServiceSettings> = {}): (() => AIServiceSettings) =>
    () => ({ enabled: true, model: '', timeoutMs: 1000, ...overrides });

describe('AIService (TASK 7.3 / 7.5 / 7.6)', () => {
    it('applies model and timeout from settings', async () => {
        const provider = new FakeProvider(['ok']);
        const service = new AIService(provider, settings({ model: 'my-model', timeoutMs: 1234 }));
        const response = await service.generate([{ role: 'user', content: 'x' }], { temperature: 0.1 });
        assert.equal(response.text, 'ok');
        assert.equal(provider.requests[0].options?.model, 'my-model');
        assert.equal(provider.requests[0].options?.timeoutMs, 1234);
        assert.equal(provider.requests[0].options?.temperature, 0.1);
    });

    it('falls back to the provider default model when the setting is empty', () => {
        assert.equal(new AIService(new FakeProvider([]), settings()).model, 'fake-model');
    });

    it('refuses to run when disabled or without a key', async () => {
        await assert.rejects(
            new AIService(new FakeProvider(['x']), settings({ enabled: false })).generate([{ role: 'user', content: 'x' }]),
            (error: AIError) => error.code === 'DISABLED');
        await assert.rejects(
            new AIService(new FakeProvider(['x'], false), settings()).generate([{ role: 'user', content: 'x' }]),
            (error: AIError) => error.code === 'MISSING_API_KEY');
    });

    it('retries rate limits and 5xx errors, then succeeds', async () => {
        const provider = new FakeProvider([
            new AIError('RATE_LIMITED', 'slow down', 'fake', 429),
            new AIError('PROVIDER_ERROR', 'overloaded', 'fake', 503),
            'finally'
        ]);
        const logs: string[] = [];
        const service = new AIService(provider, settings(), { retryDelayMs: 1, log: line => logs.push(line) });
        const response = await service.generate([{ role: 'user', content: 'x' }]);
        assert.equal(response.text, 'finally');
        assert.equal(provider.requests.length, 3);
        assert.ok(logs.some(line => line.includes('retrying')));
    });

    it('does not retry invalid keys or timeouts', async () => {
        for (const error of [
            new AIError('INVALID_API_KEY', 'bad key', 'fake', 400),
            new AIError('TIMEOUT', 'too slow', 'fake')
        ]) {
            const provider = new FakeProvider([error, 'never']);
            const service = new AIService(provider, settings(), { retryDelayMs: 1 });
            await assert.rejects(service.generate([{ role: 'user', content: 'x' }]), (e: AIError) => e.code === error.code);
            assert.equal(provider.requests.length, 1);
        }
    });

    it('gives up after maxRetries', async () => {
        const provider = new FakeProvider([
            new AIError('NETWORK', 'down', 'fake'),
            new AIError('NETWORK', 'down', 'fake'),
            new AIError('NETWORK', 'down', 'fake')
        ]);
        const service = new AIService(provider, settings(), { retryDelayMs: 1, maxRetries: 1 });
        await assert.rejects(service.generate([{ role: 'user', content: 'x' }]), (e: AIError) => e.code === 'NETWORK');
        assert.equal(provider.requests.length, 2);
    });

    it('wraps unknown provider errors into AIError', async () => {
        const service = new AIService(new FakeProvider([new Error('boom')]), settings());
        await assert.rejects(service.generate([{ role: 'user', content: 'x' }]),
            (e: unknown) => e instanceof AIError && e.code === 'PROVIDER_ERROR');
    });

    it('testConnection reports provider, model, latency and reply', async () => {
        const service = new AIService(new FakeProvider([' OK ']), settings({ model: 'm1' }));
        const result = await service.testConnection();
        assert.equal(result.provider, 'Fake AI');
        assert.equal(result.model, 'm1');
        assert.equal(result.reply, 'OK');
        assert.ok(result.latencyMs >= 0);
    });

    it('has a Vietnamese message for every error code', () => {
        const codes: AIError['code'][] = ['DISABLED', 'MISSING_API_KEY', 'INVALID_API_KEY', 'MODEL_NOT_FOUND',
            'RATE_LIMITED', 'TIMEOUT', 'CANCELLED', 'NETWORK', 'CONTENT_BLOCKED', 'INVALID_RESPONSE', 'PROVIDER_ERROR'];
        for (const code of codes) {
            const text = describeAIError(new AIError(code, 'detail', 'fake'));
            assert.ok(text.length > 10, code);
        }
    });
});
