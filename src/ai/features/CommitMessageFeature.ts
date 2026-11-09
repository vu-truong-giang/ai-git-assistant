import { GitContext } from '../context/GitContext.model';
import { parseCommitMessage } from '../parsers/commitMessageParser';
import { buildCommitMessagePrompt } from '../prompts/commitMessagePrompt';
import { AIFeatureDeps, contextRequest, FeatureUnavailableError } from './AIFeatureContext';

export interface CommitMessageResult {
    message: string;
    context: GitContext;
}

/** EPIC 09: builds the git context, asks the AI and cleans the answer. */
export class CommitMessageFeature {
    constructor(private readonly deps: AIFeatureDeps) {}

    /**
     * @param scope 'staged' (sidebar commit: only staged files get committed) or
     *              'auto' (Source Control box: staged if any, else all changes, like VS Code smart commit).
     */
    async generate(options: { scope: 'staged' | 'auto'; hint?: string; signal?: AbortSignal }): Promise<CommitMessageResult> {
        const preferences = this.deps.getPreferences();
        const context = await this.deps.contextBuilder.build(
            contextRequest(preferences, options.scope, { historyLimit: 10 })
        );
        if (context.diff.files.length === 0) {
            throw new FeatureUnavailableError(options.scope === 'staged'
                ? 'Chưa có file nào được stage. Hãy stage thay đổi trước khi tạo commit message.'
                : 'Không có thay đổi nào để tạo commit message.');
        }

        const response = await this.deps.ai.generate(
            buildCommitMessagePrompt(context, {
                language: preferences.commitLanguage,
                style: preferences.commitStyle,
                hint: options.hint
            }),
            { temperature: 0.2, signal: options.signal }
        );
        return { message: parseCommitMessage(response.text), context };
    }
}
