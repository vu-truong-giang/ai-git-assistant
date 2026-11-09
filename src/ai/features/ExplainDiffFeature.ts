import { computeDiffStats, DiffStats } from '../context/diffUtils';
import { GitContext, GitDiffScope } from '../context/GitContext.model';
import { buildExplainDiffPrompt } from '../prompts/explainDiffPrompt';
import { AIFeatureDeps, contextRequest, FeatureUnavailableError } from './AIFeatureContext';

export interface ExplainDiffResult {
    markdown: string;
    stats: DiffStats;
    context: GitContext;
}

/** EPIC 10: explains a diff in plain language. */
export class ExplainDiffFeature {
    constructor(private readonly deps: AIFeatureDeps) {}

    async explain(scope: GitDiffScope, signal?: AbortSignal): Promise<ExplainDiffResult> {
        const preferences = this.deps.getPreferences();
        const context = await this.deps.contextBuilder.build(contextRequest(preferences, scope));
        if (context.diff.files.length === 0) {
            throw new FeatureUnavailableError('Không có thay đổi nào để giải thích.');
        }
        const response = await this.deps.ai.generate(
            buildExplainDiffPrompt(context, preferences.responseLanguage),
            { temperature: 0.3, signal }
        );
        return {
            markdown: response.text.trim(),
            stats: computeDiffStats(context.diff.files),
            context
        };
    }
}
