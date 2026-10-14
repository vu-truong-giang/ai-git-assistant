import { IConflictService } from '../interfaces/ConflictService.interface';
import { GitConflict } from '../models/GitConflict.model';
import { GitCommandExecutor } from '../executor/GitCommandExecutor';

export class GitConflictService implements IConflictService {
    constructor(private executor: GitCommandExecutor) {}

    async getConflicts(): Promise<GitConflict[]> {
        try {
            const stdout = await this.executor.execute(['diff', '--name-only', '--diff-filter=U']);
            if (!stdout) {
                return [];
            }

            const conflictFiles = stdout.split('\n').filter(line => line.trim().length > 0);
            const conflicts: GitConflict[] = [];

            for (const filePath of conflictFiles) {
                const conflict = await this.parseConflictFile(filePath.trim());
                if (conflict) {
                    conflicts.push(conflict);
                }
            }

            return conflicts;
        } catch (error) {
            console.error('Failed to get conflicts', error);
            return [];
        }
    }

    async hasConflicts(): Promise<boolean> {
        try {
            const stdout = await this.executor.execute(['diff', '--name-only', '--diff-filter=U']);
            return stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    async resolveConflict(filePath: string, resolution: 'ours' | 'theirs'): Promise<void> {
        try {
            await this.executor.execute(['checkout', `--${resolution}`, '--', filePath]);
            await this.executor.execute(['add', filePath]);
        } catch (error) {
            console.error(`Failed to resolve conflict for ${filePath}`, error);
            throw error;
        }
    }


    private async parseConflictFile(filePath: string): Promise<GitConflict | null> {
        try {
            let ours = '';
            try {
                ours = await this.executor.execute(['show', `:2:${filePath}`]);
            } catch {
                ours = '';
            }

            let theirs = '';
            try {
                theirs = await this.executor.execute(['show', `:3:${filePath}`]);
            } catch {
                theirs = '';
            }

            let base: string | undefined;
            try {
                base = await this.executor.execute(['show', `:1:${filePath}`]);
            } catch {
                base = undefined;
            }

            return {
                filePath,
                ours,
                theirs,
                base
            };
        } catch {
            return null;
        }
    }
}
