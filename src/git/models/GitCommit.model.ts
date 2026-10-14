export interface GitAuthor {
    name: string;
    email: string;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: GitAuthor;
  commitor: GitAuthor;
  date: Date;
  branch?: string;
}
