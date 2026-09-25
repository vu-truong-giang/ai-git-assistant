export type GitFileStatusType =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'conflicted';

export interface GitFileStatus {
    filePath: string;
    status: GitFileStatusType;
    staged: boolean;
    oldFilePath?: string;
    additions?: number;
    deletions?: number;
}