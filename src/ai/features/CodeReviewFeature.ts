import { GitContext, GitDiffScope } from '../context/GitContext.model';
import { CodeReviewResult, parseReview } from '../parsers/reviewParser';
import { buildCodeReviewPrompt } from '../prompts/codeReviewPrompt';
import { AIFeatureDeps, contextRequest, FeatureUnavailableError } from './AIFeatureContext';

export interface CodeReviewFeatureResult extends CodeReviewResult {
    context: GitContext;
}

/** EPIC 11: structured review (logic errors, code smells, improvements). */
export class CodeReviewFeature {
    constructor(private readonly deps: AIFeatureDeps) {}

    async review(scope: GitDiffScope, signal?: AbortSignal): Promise<CodeReviewFeatureResult> {
        const preferences = this.deps.getPreferences();
        const context = await this.deps.contextBuilder.build(contextRequest(preferences, scope));
        const reviewable = context.diff.files.filter(file => !file.binary && file.status !== 'deleted');
        if (reviewable.length === 0) {
            throw new FeatureUnavailableError('Không có thay đổi mã nguồn nào để review.');
        }
        const response = await this.deps.ai.generate(
            buildCodeReviewPrompt(context, preferences.responseLanguage),
            { temperature: 0.1, responseFormat: 'json', signal }
        );
        return { ...parseReview(response.text), context };
    }
}
