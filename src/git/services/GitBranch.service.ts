import { IBranchService } from '../interfaces/IGitBranchService';
import { GitBranch } from '../models/GitBranch.model';
import { GitCommandExecutor } from '../executor/GitCommandExecutor';
import { GitStatusService } from './GitStatus.service';
export class GitBranchService implements IBranchService {
    constructor(
        private executor: GitCommandExecutor, 
        private statusService: GitStatusService) {}

    async getCurrentBranch(): Promise<GitBranch> {
        try {
            const name = (await this.executor.execute(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();

            const tracking = await this.getTrackingBranch();

            const { ahead, behind } = await this.statusService.getAheadBehind();

            return {
                name,
                current: true,
                remote: tracking ? tracking.split('/')[0] : undefined,
                tracking,
                ahead,
                behind
            };
        } catch (error) {
            console.error('Failed to get current branch', error);
            throw error;
        }
    }

    async getTrackingBranch(): Promise<string | undefined> {
        try {
            const tracking = (await this.executor.execute([
                'rev-parse', '--abbrev-ref', `@{upstream}`
            ])).trim();
            return tracking || undefined;
        } catch {
            return undefined;
        }
    }

    

    async getBranches(): Promise<GitBranch[]> {
        try {
            const stdout = await this.executor.execute([
                'branch', '-a', '--format=%(refname:short)|%(HEAD)|%(upstream:short)'
            ]);

            if (!stdout) {
                return [];
            }

            const branches: GitBranch[] = [];
            const lines = stdout.split('\n');

            for (const line of lines) {
                if (line.trim().length === 0) continue;

                const [name, head, upstream] = line.split('|');
                const isCurrent = head.trim() === '*';
                const tracking = upstream?.trim() || undefined;

                const branch: GitBranch = {
                    name: name.trim(),
                    current: isCurrent,
                    remote: tracking ? tracking.split('/')[0] : undefined,
                    tracking
                };

                if (isCurrent && tracking) {
                    const { ahead, behind } = await this.statusService.getAheadBehind();
                    branch.ahead = ahead;
                    branch.behind = behind;
                }

                branches.push(branch);
            }

            return branches;
        } catch (error) {
            console.error('Failed to get branches', error);
            return [];
        }
    }

    async createBranch(branchName: string, checkout: boolean = false): Promise<void> {
        if (checkout) {
            await this.executor.execute(['checkout', '-b', branchName]);
        } else {
            await this.executor.execute(['branch', branchName]);
        }
    }

    async switchBranch(branchName: string): Promise<void> {
        await this.executor.execute(['checkout', branchName]);
    }

    async deleteBranch(branchName: string, force: boolean = false): Promise<void> {
        const flag = force ? '-D' : '-d';
        await this.executor.execute(['branch', flag, branchName]);
    }
}
