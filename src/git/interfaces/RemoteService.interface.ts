import { GitRemote } from '../models/GitRemote.model';

export interface RemoteService {
  getRemotes(): Promise<GitRemote[]>;

  fetch(remote?: string): Promise<GitRemote[]>;

  pull(): Promise<GitRemote[]>;

  push(): Promise<GitRemote[]>;
}