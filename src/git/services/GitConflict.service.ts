import * as fs from 'fs/promises';
import * as path from 'path';
import { IConflictService } from '../interfaces/ConflictService.interface';
import { GitConflict } from '../models/GitConflict.model';
import { GitCommandExecutor } from '../executor/GitCommandExecutor';

export class GitConflictService implements IConflictService {
    constructor(
        private executor: GitCommandExecutor,
        private workspaceRoot: string
    ) {}

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
            throw error;
        }
    }

    async hasConflicts(): Promise<boolean> {
        try {
            const stdout = await this.executor.execute(['diff', '--name-only', '--diff-filter=U']);
            return stdout.trim().length > 0;
        } catch (error) {
            console.error('Failed to check for conflicts', error);
            throw error;
        }
    }

    async resolveConflict(
        filePath: string,
        resolution: 'ours' | 'theirs' | 'both'
    ): Promise<void> {
        try {
            const safePath = this.validateFilePath(filePath);
            if (resolution === 'both') {
                const absolutePath = path.resolve(this.workspaceRoot, safePath);
                const contents = await fs.readFile(absolutePath, 'utf8');
                const resolvedContents = this.acceptBoth(contents);
                await fs.writeFile(absolutePath, resolvedContents, 'utf8');
            } else {
                await this.executor.execute([
                    'checkout', `--${resolution}`, '--', safePath
                ]);
            }
            await this.executor.execute(['add', '--', safePath]);
        } catch (error) {
            console.error(`Failed to resolve conflict for ${filePath}`, error);
            throw error;
        }
    }

    async markConflictResolved(filePath: string): Promise<void> {
        const safePath = this.validateFilePath(filePath);
        await this.executor.execute(['add', '--', safePath]);
    }

    async isMergeInProgress(): Promise<boolean> {
        try {
            await this.executor.execute(['rev-parse', '--verify', 'MERGE_HEAD']);
            return true;
        } catch {
            return false;
        }
    }

    async continueMerge(): Promise<void> {
        try {
            await this.executor.execute(
                ['merge', '--continue'],
                this.workspaceRoot,
                { GIT_EDITOR: 'true' }
            );
        } catch (error) {
            console.error('Failed to continue merge', error);
            throw error;
        }
    }

    private validateFilePath(filePath: string): string {
        if (!filePath) {
            throw new Error('A conflict file path is required.');
        }
        const absolutePath = path.resolve(this.workspaceRoot, filePath);
        const relativePath = path.relative(this.workspaceRoot, absolutePath);
        if (
            relativePath === '..' ||
            relativePath.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relativePath)
        ) {
            throw new Error('Conflict file path is outside the workspace.');
        }
        return relativePath.split(path.sep).join('/');
    }

    private acceptBoth(contents: string): string {
        const lines = contents.split(/\r?\n/);
        const lineEnding = contents.includes('\r\n') ? '\r\n' : '\n';
        const output: string[] = [];
        let ours: string[] = [];
        let theirs: string[] = [];
        let section: 'ours' | 'base' | 'theirs' | undefined;
        let foundConflict = false;

        for (const line of lines) {
            if (line.startsWith('<<<<<<< ')) {
                if (section) {
                    throw new Error('Conflict markers are malformed or nested.');
                }
                section = 'ours';
                ours = [];
                theirs = [];
                foundConflict = true;
            } else if (line.startsWith('||||||| ')) {
                if (section !== 'ours') {
                    throw new Error('Conflict markers are malformed.');
                }
                section = 'base';
            } else if (line === '=======') {
                if (section !== 'ours' && section !== 'base') {
                    throw new Error('Conflict markers are malformed.');
                }
                section = 'theirs';
            } else if (line.startsWith('>>>>>>> ')) {
                if (section !== 'theirs') {
                    throw new Error('Conflict markers are malformed.');
                }
                output.push(...ours, ...theirs);
                section = undefined;
            } else if (section === 'ours') {
                ours.push(line);
            } else if (section === 'theirs') {
                theirs.push(line);
            } else if (!section) {
                output.push(line);
            }
        }

        if (section) {
            throw new Error('Conflict markers are incomplete.');
        }
        if (!foundConflict) {
            throw new Error('No merge conflict markers found in the file.');
        }
        return output.join(lineEnding);
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
