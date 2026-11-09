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

export interface GitRawDiffOptions {
    /** Diff the index against HEAD instead of the working tree against the index. */
    staged?: boolean;
    /** Revision range such as "main...HEAD". Ignored when staged is true. */
    range?: string;
    filePath?: string;
    contextLines?: number;
}
