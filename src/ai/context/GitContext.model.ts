import { GitFileStatus } from '../../git/models/GitFileStatus.model';
import { LimitedDiff } from './ContextLimiter';

/**
 * Which changes go into the diff:
 *  - staged:  index vs HEAD (what the next commit contains)
 *  - working: working tree vs index, plus untracked files
 *  - all:     working tree vs HEAD, plus untracked files
 *  - auto:    staged if anything is staged, otherwise all
 *  - range:   a revision range such as "main...HEAD"
 *  - none:    no diff (status/history only)
 */
export type GitDiffScope = 'staged' | 'working' | 'all' | 'auto' | 'none' | { range: string };

export interface GitContextRequest {
    diff: GitDiffScope;
    /** Number of recent commits to include (0 = none). */
    historyLimit?: number;
    /** Range for the history, e.g. "main..HEAD". Defaults to HEAD. */
    historyRange?: string;
    /** Character budget for the diff part of the context. */
    maxChars: number;
    excludePatterns?: readonly string[];
    redactSecrets?: boolean;
}

export interface GitContextCommit {
    shortHash: string;
    message: string;
    author: string;
    date: string;
}

export interface GitContext {
    branch: string;
    trackingBranch?: string;
    ahead: number;
    behind: number;
    files: GitFileStatus[];
    /** The scope that was actually used (auto resolved to staged/all). */
    diffScope: 'staged' | 'working' | 'all' | 'range' | 'none';
    range?: string;
    diff: LimitedDiff;
    recentCommits: GitContextCommit[];
}
