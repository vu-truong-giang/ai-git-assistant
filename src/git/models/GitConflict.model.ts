export interface GitConflict {
  filePath: string;
  ours: string;
  theirs: string;
  base?: string;
}