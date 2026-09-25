export type GitDiffChangeType = 'added' | 'removed' | 'unchanged';

export interface GitDiffChange {
    oldLineNumber: number | null;
    newLineNumber: number | null;
    content: string;
    type: GitDiffChangeType;
}

export interface GitDiff {
    filePath: string;
    changes: GitDiffChange[];
    additions: number;
    deletions: number;
}