import { IStatusService } from '../interfaces/StatusService.interface';
import { GitFileStatus, GitFileStatusType } from '../models/GitFileStatus.model';
import { GitCommandExecutor } from '../executor/GitCommandExecutor';

export class GitStatusService implements IStatusService {
    constructor(private executor: GitCommandExecutor) {}

    async getStatus(): Promise<GitFileStatus[]> {
        try {
            const stdout = await this.executor.execute(['status', '--porcelain']);
            if (!stdout) {
                return [];
            }

            const changes: GitFileStatus[] = [];
            const lines = stdout.split('\n');

            for (const line of lines) {
                if (line.trim().length === 0) continue;

                const statusStr = line.substring(0, 2);
                const filePath = line.substring(3).trim();

                let statusType: GitFileStatusType = 'untracked';
                let staged = false;

                // X (Index) and Y (Working tree)
                const x = statusStr[0];
                const y = statusStr[1];

                if (x === 'M' || x === 'A' || x === 'D' || x === 'R' || x === 'C') {
                    staged = true;
                }
                
                if (x === '?' && y === '?') {
                    statusType = 'untracked';
                } else if (x === 'M' || y === 'M') {
                    statusType = 'modified';
                } else if (x === 'A' || y === 'A') {
                    statusType = 'added';
                } else if (x === 'D' || y === 'D') {
                    statusType = 'deleted';
                } else if (x === 'R' || y === 'R') {
                    statusType = 'renamed';
                } else if (x === 'C' || y === 'C') {
                    statusType = 'copied';
                } else if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
                    statusType = 'conflicted';
                }

                changes.push({
                    filePath,
                    status: statusType,
                    staged
                });
            }

            return changes;
        } catch (error) {
            console.error('Failed to get git status', error);
            return [];
        }
    }

    async getStagedFiles(): Promise<GitFileStatus[]> {
        const allStatus = await this.getStatus();
        return allStatus.filter(file => file.staged);
    }

    async getUnstagedFiles(): Promise<GitFileStatus[]> {
        const allStatus = await this.getStatus();
        return allStatus.filter(file => !file.staged && file.status !== 'untracked');
    }

    async getUntrackedFiles(): Promise<GitFileStatus[]> {
        const allStatus = await this.getStatus();
        return allStatus.filter(file => file.status === 'untracked');
    }
}
