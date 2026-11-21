import { GitContextCommit } from '../context/GitContext.model';
import { buildBranchSummaryPrompt, buildHistorySummaryPrompt } from '../prompts/summaryPrompts';
import { AIFeatureDeps, contextRequest, FeatureUnavailableError } from './AIFeatureContext';

export interface SummaryResult {
    markdown: string;
    title: string;
}

const COUNT_LIMIT = 1000;

/** EPIC 13: commit history summary and branch-vs-base summary. */
export class SummaryFeature {
    constructor(private readonly deps: AIFeatureDeps) {}

    async summarizeHistory(limit: number, signal?: AbortSignal): Promise<SummaryResult> {
        const preferences = this.deps.getPreferences();
        const context = await this.deps.contextBuilder.build(
            contextRequest(preferences, 'none', { historyLimit: limit })
        );
        if (context.recentCommits.length === 0) {
            throw new FeatureUnavailableError('Repository chưa có commit nào.');
        }
        const commits = fitCommits(context.recentCommits, preferences.maxContextChars);
        const response = await this.deps.ai.generate(
            buildHistorySummaryPrompt(context.branch, commits, preferences.responseLanguage),
            { temperature: 0.3, signal }
        );
        return {
            title: `Tóm tắt lịch sử: ${context.branch} (${commits.length} commit)`,
            markdown: response.text.trim()
        };
    }

    async summarizeBranch(baseBranch: string, signal?: AbortSignal): Promise<SummaryResult> {
        const preferences = this.deps.getPreferences();
        const [aheadCommits, behindCommits] = await Promise.all([
            this.deps.commits.getHistory(COUNT_LIMIT, `${baseBranch}..HEAD`),
            this.deps.commits.getHistory(COUNT_LIMIT, `HEAD..${baseBranch}`)
        ]);
        if (aheadCommits.length === 0) {
            throw new FeatureUnavailableError(`Branch hiện tại không có commit nào mới so với "${baseBranch}".`);
        }

        const context = await this.deps.contextBuilder.build(contextRequest(
            preferences,
            { range: `${baseBranch}...HEAD` },
            { historyLimit: 100, historyRange: `${baseBranch}..HEAD` }
        ));
        const response = await this.deps.ai.generate(
            buildBranchSummaryPrompt(
                context,
                baseBranch,
                { ahead: aheadCommits.length, behind: behindCommits.length },
                preferences.responseLanguage
            ),
            { temperature: 0.3, signal }
        );
        return {
            title: `Tóm tắt branch: ${context.branch} so với ${baseBranch}`,
            markdown: response.text.trim()
        };
    }
}

/** Drops the oldest commits if the list alone exceeds the budget. */
function fitCommits(commits: GitContextCommit[], maxChars: number): GitContextCommit[] {
    let size = 0;
    const result: GitContextCommit[] = [];
    for (const commit of commits) {
        size += commit.message.length + commit.author.length + 30;
        if (size > maxChars) {
            break;
        }
        result.push(commit);
    }
    return result;
}
