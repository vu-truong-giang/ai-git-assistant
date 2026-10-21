import { GitRepository, GitRepositoryInfo } from "../models/GitRepository.model";

export interface IGitRepositoryService {
    checkRepository(workspacePath: string): Promise<GitRepositoryInfo>;
    getRepository(): Promise<GitRepository>;
    getRootPath(): Promise<string>;
    initializeRepository(): Promise<void>;
    isRepositoryInitialized(): Promise<boolean>;
}