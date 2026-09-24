import { IDiffService } from '../interfaces/DiffService.interface';
import { GitDiff } from '../models/GitDiff.model';
import { GitCommandExecutor } from '../executor/GitCommandExecutor';

export class GitDiffService implements IDiffService {
    constructor(private executor: GitCommandExecutor) {}

    async getDiff(): Promise<GitDiff[]> {
        // TODO: Implement parsing git diff
        return [];
    }

    async getFileDiff(filePath: string): Promise<GitDiff> {
        // TODO: Implement parsing git diff for single file
        return { filePath, changes: [], additions: 0, deletions: 0 };
    }

    async getStagedDiff(): Promise<GitDiff[]> {
        // TODO: Implement parsing git diff --staged
        return [];
    }

    async getFileContent(filePath: string, ref: string): Promise<string> {
        try {
            // Use git show to get the file content at a specific ref (e.g. HEAD)
            const content = await this.executor.execute(['show', `${ref}:${filePath}`]);
            return content;
        } catch (error) {
            console.error(`Failed to get file content for ${filePath} at ${ref}`, error);
            // Return empty string if file doesn't exist at HEAD (e.g., newly added file)
            return '';
        }
    }
}
