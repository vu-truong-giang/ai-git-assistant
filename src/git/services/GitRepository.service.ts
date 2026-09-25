import { IRepositoryService } from '../interfaces/RepositoryService.interface';
import { GitRepository } from '../models/GitRepository.model';
import { GitCommandExecutor } from '../executor/GitCommandExecutor';

export class GitRepositoryService implements IRepositoryService {
    constructor(private executor: GitCommandExecutor) {}

    async getRepository(): Promise<GitRepository> {
        try {
            const rootPath = await this.getRootPath();
            const name = this.extractRepoName(rootPath);
            const currentBranch = await this.getCurrentBranchName();
            const isClear = await this.isWorkingTreeClean();

            return {
                name,
                rootPath,
                currentBranch,
                isClear,
                commits: [],
                remotes: []
            };
        } catch (error) {
            console.error('Failed to get repository info', error);
            throw error;
        }
    }

    async getRootPath(): Promise<string> {
        try {
            const output = await this.executor.execute(['rev-parse', '--show-toplevel']);
            return output.trim();
        } catch (error) {
            console.error('Failed to get repository root path', error);
            throw error;
        }
    }

    async initializeRepository(): Promise<void> {
        await this.executor.execute(['init']);
    }

    async isRepositoryInitialized(): Promise<boolean> {
        try {
            await this.executor.execute(['rev-parse', '--is-inside-work-tree']);
            return true;
        } catch {
            return false;
        }
    }


    private async getCurrentBranchName(): Promise<string> {
        try {
            const output = await this.executor.execute(['rev-parse', '--abbrev-ref', 'HEAD']);
            return output.trim();
        } catch {
            return 'HEAD (detached)';
        }
    }

    private async isWorkingTreeClean(): Promise<boolean> {
        try {
            const output = await this.executor.execute(['status', '--porcelain']);
            return output.trim().length === 0;
        } catch {
            return false;
        }
    }

    private extractRepoName(rootPath: string): string {
        const normalized = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
        const segments = normalized.split('/');
        return segments[segments.length - 1] || 'unknown';
    }
}
