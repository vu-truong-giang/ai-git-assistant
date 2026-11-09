import { AIService } from '../AIService';
import { AIPreferences } from '../AIPreferences';
import { GitContextBuilder } from '../context/GitContextBuilder';
import { GitContextRequest, GitDiffScope } from '../context/GitContext.model';
import { ICommitService } from '../../git/interfaces/CommitService.interface';

/** Shared dependencies of all AI features. */
export interface AIFeatureDeps {
    ai: AIService;
    contextBuilder: GitContextBuilder;
    commits: Pick<ICommitService, 'getHistory'>;
    getPreferences: () => AIPreferences;
}

/** Thrown when a feature cannot run for a reason the user can fix (nothing staged, ...). */
export class FeatureUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FeatureUnavailableError';
    }
}

export function contextRequest(
    preferences: AIPreferences,
    diff: GitDiffScope,
    extra: Partial<GitContextRequest> = {}
): GitContextRequest {
    return {
        diff,
        maxChars: preferences.maxContextChars,
        excludePatterns: preferences.excludePatterns,
        redactSecrets: preferences.redactSecrets,
        ...extra
    };
}
