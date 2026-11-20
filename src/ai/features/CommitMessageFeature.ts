
import { AIError } from '../models/AIError.model';
import { GitContext } from '../context/GitContext.model';
import { parseCommitMessage } from '../parsers/commitMessageParser';
import { buildCommitMessagePrompt } from '../prompts/commitMessagePrompt';
import {
    AIFeatureDeps,
    contextRequest,
    FeatureUnavailableError
} from './AIFeatureContext';

export interface CommitMessageResult {
    message: string;
    context: GitContext;
}


const COMMIT_AI_TIMEOUT_MS = 45_000;
const COMMIT_MAX_OUTPUT_TOKENS = 256;
const COMMIT_MAX_RETRIES = 2;
export class CommitMessageFeature {
    constructor(private readonly deps: AIFeatureDeps) {}

    /**
     * staged: only staged changes.
     * auto: staged changes if present, otherwise all changes.
     */
    async generate(options: {
        scope: 'staged' | 'auto';
        hint?: string;
        signal?: AbortSignal;
    }): Promise<CommitMessageResult> {
        const started = Date.now();
        const preferences = this.deps.getPreferences();

        if (options.signal?.aborted) {
            throw new AIError(
                'CANCELLED',
                'Commit message generation was cancelled.',
                'ai'
            );
        }

        console.log('[AI Commit] Building Git context...');

        const context = await this.deps.contextBuilder.build(
            contextRequest(preferences, options.scope),
            options.signal
        );

        if (options.signal?.aborted) {
            throw new AIError(
                'CANCELLED',
                'Commit message generation was cancelled.',
                'ai'
            );
        }

        if (context.diff.files.length === 0) {
            throw new FeatureUnavailableError(
                options.scope === 'staged'
                    ? 'Chưa có file nào được stage. Hãy stage thay đổi trước khi tạo commit message.'
                    : 'Không có thay đổi nào để tạo commit message.'
            );
        }

        if (!context.diff.text.trim()) {
            throw new FeatureUnavailableError(
                'Không có nội dung diff phù hợp để tạo commit message. ' +
                'Các file có thể đã bị loại bỏ do nhạy cảm hoặc nằm trong danh sách exclude.'
            );
        }

        const contextDuration = Date.now() - started;

        console.log(
            `[AI Commit] Context ready in ${contextDuration} ms; ` +
            `${context.diff.text.length} chars`
        );

        const prompt = buildCommitMessagePrompt(context, {
            language: preferences.commitLanguage,
            style: preferences.commitStyle,
            hint: options.hint
        });

        const promptChars = prompt.reduce(
            (sum, message) => sum + message.content.length,
            0
        );

        console.log(`[AI Commit] Sending ${promptChars} prompt characters to Gemini...`);

        const aiStarted = Date.now();

        const response = await this.deps.ai.generate(prompt, {
            temperature: 0.2,
            maxOutputTokens: COMMIT_MAX_OUTPUT_TOKENS,
            timeoutMs: COMMIT_AI_TIMEOUT_MS,
            maxRetries: COMMIT_MAX_RETRIES,
            signal: options.signal
        });

        if (options.signal?.aborted) {
            throw new AIError(
                'CANCELLED',
                'Commit message generation was cancelled.',
                'ai'
            );
        }

        const message = parseCommitMessage(response.text);

        console.log(
            `[AI Commit] Gemini completed in ${Date.now() - aiStarted} ms; ` +
            `total ${Date.now() - started} ms`
        );

        return { message, context };
    }
}
