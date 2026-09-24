export interface GitBranch {
  name: string;
  current: boolean;
  remote?: string;
}