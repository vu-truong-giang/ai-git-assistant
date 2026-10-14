import { GitRemote } from '../models/GitRemote.model';

export interface IRemoteService {
  getRemotes(): Promise<GitRemote[]>;

  fetch(remote?: string): Promise<GitRemote[]>;

  pull(): Promise<GitRemote[]>;

  push(): Promise<GitRemote[]>;
}
