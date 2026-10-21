
import { GitCommandExecutor } from './../executor/GitCommandExecutor';
import {
    GitRepositoryInfo,
    IGitRepositoryService
} from './../interfaces/IGitRepositoryService';


export class GitRepositoryService implements IGitRepositoryService {
    constructor(
        private readonly executor: GitCommandExecutor
    ) {}
    async checkRepository(
        workspacePath: string
    ): Promise<GitRepositoryInfo> {
        try {
            const result = await this.executor.execute(
                ['rev-parse', '--show-toplevel'],
                workspacePath
            );
            const repositoryRoot = result.trim();
            if (!repositoryRoot) {
                return {
                    isGitRepository: false
                };
            }
            return {
                isGitRepository: true,
                repositoryRoot
            };
        } catch (error) {
            console.error('Failed to check Git repository', error);
            return {
                isGitRepository: false
            };
        }
    }
}