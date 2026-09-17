export type GitRemoteType = 'origin' | 'upstream';


export interface GitRemote {
  name: string;
  type: GitRemoteType;
  fetchUrl: string;
  pushUrl: string;
}
