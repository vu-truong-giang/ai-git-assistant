import { GitDiff, GitRawDiffOptions } from '../models/GitDiff.model';

export interface IDiffService {
    getDiff(): Promise<GitDiff[]>;
    getFileDiff(filePath: string): Promise<GitDiff>;
    getStagedDiff(): Promise<GitDiff[]>;
    getFileContent(filePath: string, ref: string): Promise<string>;
    /** Unified diff text exactly as git prints it (used as AI context). */
    getRawDiff(options?: GitRawDiffOptions): Promise<string>;
}