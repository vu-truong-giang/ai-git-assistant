
import { computeDiffStats, DiffStats } from '../context/diffUtils';
import { GitContext, GitDiffScope } from '../context/GitContext.model';
import { buildExplainDiffPrompt } from '../prompts/explainDiffPrompt';
import { AIError } from '../models/AIError.model';
import { AIFeatureDeps, contextRequest, FeatureUnavailableError } from './AIFeatureContext';

export interface ExplainDiffResult {
    markdown: string;
    stats: DiffStats;
    context: GitContext;
}

/** EPIC 10: explains a diff in plain language. */
export class ExplainDiffFeature {
    constructor(private readonly deps: AIFeatureDeps) {}

    async explain(
        scope: GitDiffScope,
        signal?: AbortSignal,
        onChunk?: (chunk: string) => void
    ): Promise<ExplainDiffResult> {
        const preferences = this.deps.getPreferences();

        const contextStarted = Date.now();

        // Truyền AbortSignal để người dùng có thể hủy cả quá trình
        // thu thập Git context, không chỉ request gửi đến AI.
        const context = await this.deps.contextBuilder.build(
            contextRequest(preferences, scope),
            signal
        );

        const contextDuration = Date.now() - contextStarted;

        console.log(
            `[AI Explain Diff] Context built in ${contextDuration} ms`
        );

        if (signal?.aborted) {
            throw new AIError(
                'CANCELLED',
                'The explanation request was cancelled.',
                this.deps.ai.providerId
            );
        }

        if (context.diff.files.length === 0) {
            throw new FeatureUnavailableError(
                'Không có thay đổi nào để giải thích.'
            );
        }

        const prompt = buildExplainDiffPrompt(
            context,
            preferences.responseLanguage
        );

        const promptChars = prompt.reduce(
            (sum, message) => sum + message.content.length,
            0
        );

        console.log(
            `[AI Explain Diff] Prompt prepared: ${promptChars} characters`
        );

        const response = onChunk
            ? await this.deps.ai.generateStream(
                prompt,
                onChunk,
                { temperature: 0.3, signal }
            )
            : await this.deps.ai.generate(
                prompt,
                { temperature: 0.3, signal }
            );

        const markdown = response.text.trim();

        // Phòng trường hợp provider trả về response rỗng.
        if (!markdown) {
            throw new AIError(
                'INVALID_RESPONSE',
                'AI returned an empty explanation.',
                this.deps.ai.providerId
            );
        }

        return {
            markdown,
            stats: computeDiffStats(context.diff.files),
            context
        };
    }
}
