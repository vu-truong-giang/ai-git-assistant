export interface GitRepositoryInfo {
    isGitRepository: boolean;
    repositoryRoot?: string;
}

export interface IGitRepositoryService {
    checkRepository(workspacePath: string): Promise<GitRepositoryInfo>;
}