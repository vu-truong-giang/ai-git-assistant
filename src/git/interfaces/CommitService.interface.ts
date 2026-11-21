import { GitCommit } from '../models/GitCommit.model';

export interface ICommitService {
    commit(message: string, amend?: boolean): Promise<GitCommit>;
    /** Most recent commits first. range e.g. "main..HEAD"; defaults to HEAD. */
    getHistory(limit: number, range?: string): Promise<GitCommit[]>;
}
