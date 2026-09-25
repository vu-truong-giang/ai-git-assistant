import { IDiffService } from '../interfaces/DiffService.interface';
import { GitDiff, GitDiffChange, GitDiffChangeType } from '../models/GitDiff.model';
import { GitCommandExecutor } from '../executor/GitCommandExecutor';

export class GitDiffService implements IDiffService {
    constructor(private executor: GitCommandExecutor) {}

    async getDiff(): Promise<GitDiff[]> {
        try {
            const stdout = await this.executor.execute(['diff', '--unified=3']);
            if (!stdout) {
                return [];
            }
            return this.parseDiffOutput(stdout);
        } catch (error) {
            console.error('Failed to get diff', error);
            return [];
        }
    }

    async getFileDiff(filePath: string): Promise<GitDiff> {
        try {
            const stdout = await this.executor.execute(['diff', '--unified=3', '--', filePath]);
            if (!stdout) {
                return { filePath, changes: [], additions: 0, deletions: 0 };
            }

            const diffs = this.parseDiffOutput(stdout);
            return diffs.length > 0
                ? diffs[0]
                : { filePath, changes: [], additions: 0, deletions: 0 };
        } catch (error) {
            console.error(`Failed to get diff for ${filePath}`, error);
            return { filePath, changes: [], additions: 0, deletions: 0 };
        }
    }

    async getStagedDiff(): Promise<GitDiff[]> {
        try {
            const stdout = await this.executor.execute(['diff', '--staged', '--unified=3']);
            if (!stdout) {
                return [];
            }
            return this.parseDiffOutput(stdout);
        } catch (error) {
            console.error('Failed to get staged diff', error);
            return [];
        }
    }

    async getFileContent(filePath: string, ref: string): Promise<string> {
        try {
            const content = await this.executor.execute(['show', `${ref}:${filePath}`]);
            return content;
        } catch (error) {
            console.error(`Failed to get file content for ${filePath} at ${ref}`, error);
            return '';
        }
    }


    private parseDiffOutput(output: string): GitDiff[] {
        const diffs: GitDiff[] = [];
        const fileBlocks = output.split(/^diff --git /m).filter(b => b.trim().length > 0);

        for (const block of fileBlocks) {
            const diff = this.parseFileDiffBlock(block);
            if (diff) {
                diffs.push(diff);
            }
        }

        return diffs;
    }

    private parseFileDiffBlock(block: string): GitDiff | null {
        const lines = block.split('\n');

        const headerMatch = lines[0].match(/a\/(.+?)\s+b\/(.+)/);
        if (!headerMatch) {
            return null;
        }
        const filePath = headerMatch[2];

        const changes: GitDiffChange[] = [];
        let additions = 0;
        let deletions = 0;
        let oldLine = 0;
        let newLine = 0;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];

            const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
            if (hunkMatch) {
                oldLine = parseInt(hunkMatch[1], 10);
                newLine = parseInt(hunkMatch[2], 10);
                continue;
            }

            if (line.startsWith('---') || line.startsWith('+++') ||
                line.startsWith('index ') || line.startsWith('old mode') ||
                line.startsWith('new mode') || line.startsWith('new file') ||
                line.startsWith('deleted file') || line.startsWith('similarity') ||
                line.startsWith('rename') || line.startsWith('Binary')) {
                continue;
            }

            if (line.startsWith('+')) {
                changes.push({
                    oldLineNumber: null,
                    newLineNumber: newLine,
                    content: line.substring(1),
                    type: 'added' as GitDiffChangeType
                });
                additions++;
                newLine++;
            } else if (line.startsWith('-')) {
                changes.push({
                    oldLineNumber: oldLine,
                    newLineNumber: null,
                    content: line.substring(1),
                    type: 'removed' as GitDiffChangeType
                });
                deletions++;
                oldLine++;
            } else if (line.startsWith(' ')) {
                changes.push({
                    oldLineNumber: oldLine,
                    newLineNumber: newLine,
                    content: line.substring(1),
                    type: 'unchanged' as GitDiffChangeType
                });
                oldLine++;
                newLine++;
            }
        }

        return { filePath, changes, additions, deletions };
    }
}
