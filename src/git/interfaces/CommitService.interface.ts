import { GitCommit } from '../models/GitCommit.model';

export interface ICommitService {
    commit(message: string, amend?: boolean): Promise<GitCommit>;
}