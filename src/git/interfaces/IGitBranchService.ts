import { GitBranch } from '../models/GitBranch.model';

export interface IBranchService {
    getBranches(): Promise<GitBranch[]>;
    getCurrentBranch(): Promise<GitBranch>;
    getTrackingBranch(): Promise<string | undefined>;
    createBranch(branchName: string, checkout?: boolean): Promise<void>;
    switchBranch(branchName: string): Promise<void>;
    deleteBranch(branchName: string, force?: boolean): Promise<void>;
}
