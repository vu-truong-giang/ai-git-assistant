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
            const remoteNames = (await this.executor.execute(['remote']))
                .split(/\r?\n/)
                .filter(Boolean)
                .sort((left, right) => right.length - left.length);
            const stdout = await this.executor.execute([
                'branch', '-a',
                '--format=%(refname:short)|%(HEAD)|%(upstream:short)|%(refname)'
            ]);

            if (!stdout) {
                return [];
            }

            const branches: GitBranch[] = [];
            const lines = stdout.split('\n');

            for (const line of lines) {
                if (line.trim().length === 0) continue;

                const [name, head, upstream, refname] = line.split('|');
                if (
                    refname?.startsWith('refs/remotes/') &&
                    remoteNames.some(remote => name === `${remote}/HEAD`)
                ) {
                    continue;
                }
                const isCurrent = head.trim() === '*';
                const tracking = upstream?.trim() || undefined;
                const isRemote = refname?.startsWith('refs/remotes/') ?? false;
                const remoteName = isRemote
                    ? remoteNames.find(remote => name.startsWith(`${remote}/`))
                    : undefined;

                const branch: GitBranch = {
                    name: name.trim(),
                    current: isCurrent,
                    remote: tracking ? tracking.split('/')[0] : undefined,
                    tracking,
                    isRemote,
                    remoteName,
                    remoteBranch: remoteName
                        ? name.slice(remoteName.length + 1)
                        : undefined
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
        const validationError = await this.validateBranchName(branchName);
        if (validationError) {
            throw new Error(validationError);
        }
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
        const currentBranch = await this.getCurrentBranch();
        if (currentBranch.name === branchName) {
            throw new Error('Cannot delete the currently checked out branch.');
        }
        const flag = force ? '-D' : '-d';
        await this.executor.execute(['branch', flag, branchName]);
    }

    async deleteRemoteBranch(remoteName: string, branchName: string): Promise<void> {
        if (!remoteName || !branchName) {
            throw new Error('A remote name and branch name are required.');
        }
        await this.executor.execute(['push', remoteName, '--delete', branchName]);
    }

    async renameBranch(oldName: string, newName: string): Promise<void> {
        if (oldName === newName) {
            return;
        }
        const validationError = await this.validateBranchName(newName);
        if (validationError) {
            throw new Error(validationError);
        }
        await this.executor.execute(['branch', '-m', oldName, newName]);
    }

    async validateBranchName(branchName: string): Promise<string | undefined> {
        if (!branchName.trim()) {
            return 'Branch name cannot be empty.';
        }
        try {
            const validatedName = (await this.executor.execute([
                'check-ref-format', '--branch', branchName
            ])).trim();
            return validatedName === branchName
                ? undefined
                : 'Enter a valid branch name.';
        } catch {
            return 'Enter a valid branch name.';
        }
    }

    async mergeBranch(branchName: string): Promise<'merged' | 'conflicts'> {
        if (!branchName.trim()) {
            throw new Error('A source branch is required.');
        }
        const existingConflicts = await this.executor.execute([
            'diff', '--name-only', '--diff-filter=U'
        ]);
        if (existingConflicts.trim()) {
            throw new Error('Resolve existing conflicts before starting another merge.');
        }
        let mergeInProgress = false;
        try {
            await this.executor.execute([
                'rev-parse', '--verify', 'MERGE_HEAD'
            ]);
            mergeInProgress = true;
        } catch {
            mergeInProgress = false;
        }
        if (mergeInProgress) {
            throw new Error('A merge is already in progress.');
        }

        try {
            await this.executor.execute(['merge', '--no-edit', '--', branchName]);
            return 'merged';
        } catch (error) {
            const conflicts = await this.executor.execute([
                'diff', '--name-only', '--diff-filter=U'
            ]);
            if (conflicts.trim()) {
                return 'conflicts';
            }
            throw error;
        }
    }
}
