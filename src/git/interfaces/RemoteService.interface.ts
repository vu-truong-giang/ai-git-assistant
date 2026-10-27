import { GitRemote } from '../models/GitRemote.model';

export interface IRemoteService {
  getRemotes(): Promise<GitRemote[]>;

  fetch(remote?: string): Promise<GitRemote[]>;

  pull(remote?: string, branch?: string): Promise<GitRemote[]>;

  push(
    remote?: string,
    branch?: string,
    setUpstream?: boolean
  ): Promise<GitRemote[]>;
}
