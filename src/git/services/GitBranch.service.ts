import { IBranchService } from '../interfaces/BranchService.interface';
import { GitBranch } from '../models/GitBranch.model';
import { GitCommandExecutor } from '../executor/GitCommandExecutor';

export class GitBranchService implements IBranchService {
    constructor(private executor: GitCommandExecutor) {}

    async getCurrentBranch(): Promise<GitBranch> {
        try {
            const name = (await this.executor.execute(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();

            const tracking = await this.getTrackingBranch(name);

            const { ahead, behind } = await this.getAheadBehind(name);

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

    async getTrackingBranch(branchName: string): Promise<string | undefined> {
        try {
            const tracking = (await this.executor.execute([
                'rev-parse', '--abbrev-ref', `${branchName}@{upstream}`
            ])).trim();
            return tracking || undefined;
        } catch {
            return undefined;
        }
    }

    async getAheadBehind(branchName: string): Promise<{ ahead: number; behind: number }> {
        try {
            const tracking = await this.getTrackingBranch(branchName);
            if (!tracking) {
                return { ahead: 0, behind: 0 };
            }

            const output = (await this.executor.execute([
                'rev-list', '--left-right', '--count', `${branchName}...${tracking}`
            ])).trim();

            const parts = output.split(/\s+/);
            return {
                ahead: parseInt(parts[0], 10) || 0,
                behind: parseInt(parts[1], 10) || 0
            };
        } catch {
            return { ahead: 0, behind: 0 };
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
                    const { ahead, behind } = await this.getAheadBehind(name.trim());
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
