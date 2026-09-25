export interface GitBranch {
  name: string;
  current: boolean;
  remote?: string;
  tracking?: string;
  ahead?: number;
  behind?: number;
}