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
    oldFilePath?: string; // For renamed or copied files, this will hold the original file path
    additions?: number; // Number of lines added
    deletions?: number; // Number of lines deleted
}