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

                const x = line[0];
                const y = line[1];
                const filePath = line.substring(3).trim();

                if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
                    changes.push({ filePath, status: 'conflicted', staged: false });
                    continue;
                }

                if (x === '?' && y === '?') {
                    changes.push({ filePath, status: 'untracked', staged: false });
                    continue;
                }

                if (x === '!' && y === '!') {
                    changes.push({ filePath, status: 'ignored', staged: false });
                    continue;
                }

                if (x !== ' ' && x !== '?') {
                    const stagedType = this.mapCharToStatus(x);
                    changes.push({ filePath, status: stagedType, staged: true });
                }

                if (y !== ' ' && y !== '?') {
                    const unstagedType = this.mapCharToStatus(y);
                    changes.push({ filePath, status: unstagedType, staged: false });
                }
            }

            return changes;
        } catch (error) {
            console.error('Failed to get git status', error);
            return [];
        }
    }

    private mapCharToStatus(char: string): GitFileStatusType {
        switch (char) {
            case 'M': return 'modified';
            case 'A': return 'added';
            case 'D': return 'deleted';
            case 'R': return 'renamed';
            case 'C': return 'copied';
            default: return 'modified';
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
