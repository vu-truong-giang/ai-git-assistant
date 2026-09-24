import { GitCommit } from './GitCommit.model';
import { GitRemote } from './GitRemote.model';

export interface GitRepository {
    name: string;
    rootPath: string;
    currentBranch: string;
    isClear: boolean;
    commits: GitCommit[];
    remotes: GitRemote[];
}