import { GitRepository } from '../models/GitRepository.model';

export interface IRepositoryService {
    getRepository(): Promise<GitRepository>;

    getRootPath(): Promise<string>;
    initializeRepository(): Promise<void>;
    isRepositoryInitialized(): Promise<boolean>;
}