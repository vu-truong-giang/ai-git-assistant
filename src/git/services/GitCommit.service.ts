import { ICommitService } from '../interfaces/CommitService.interface';
import { GitCommit, GitAuthor } from '../models/GitCommit.model';
import { GitCommandExecutor } from '../executor/GitCommandExecutor';

export class GitCommitService implements ICommitService {
    constructor(private executor: GitCommandExecutor) {}

    async commit(message: string, amend: boolean = false): Promise<GitCommit> {
        try {
            const args = ['commit', '-m', message];
            if (amend) {
                args.push('--amend');
            }

            await this.executor.execute(args);

            return await this.getLastCommit();
        } catch (error) {
            console.error('Failed to commit', error);
            throw error;
        }
    }


    async getHistory(limit: number, range = 'HEAD'): Promise<GitCommit[]> {
        if (range.startsWith('-')) {
            throw new Error(`Invalid revision range: ${range}`);
        }
        const separator = '\x1f';
        const format = ['%H', '%h', '%an', '%ae', '%cn', '%ce', '%aI', '%s']
            .join('%x1f');

        let stdout: string;
        try {
            stdout = await this.executor.execute([
                'log', `-n${Math.max(1, Math.floor(limit))}`, `--format=${format}`, range, '--'
            ]);
        } catch (error) {
            // A repository without commits has no history yet.
            if (String(error).includes('does not have any commits yet')) {
                return [];
            }
            throw error;
        }

        return stdout.split(/\r?\n/).filter(Boolean).map(line => {
            const parts = line.split(separator);
            return {
                hash: parts[0],
                shortHash: parts[1],
                author: { name: parts[2], email: parts[3] },
                commitor: { name: parts[4], email: parts[5] },
                date: new Date(parts[6]),
                message: parts[7] ?? ''
            };
        });
    }

    private async getLastCommit(): Promise<GitCommit> {
        const separator = '|__|';
        const format = [
            '%H',
            '%h',
            '%an',
            '%ae',
            '%cn',
            '%ce',
            '%aI',
            '%s'
        ].join(separator);

        const stdout = await this.executor.execute([
            'log', '-1', `--format=${format}`
        ]);

        const parts = stdout.trim().split(separator);

        const author: GitAuthor = {
            name: parts[2],
            email: parts[3]
        };

        const commitor: GitAuthor = {
            name: parts[4],
            email: parts[5]
        };

        return {
            hash: parts[0],
            shortHash: parts[1],
            message: parts[7],
            author,
            commitor,
            date: new Date(parts[6])
        };
    }
}
