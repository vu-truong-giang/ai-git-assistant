import { GitCommit } from '../models/GitCommit.model';

export interface CommitService {
    commit(message: string, amend?: boolean): Promise<GitCommit>;
}