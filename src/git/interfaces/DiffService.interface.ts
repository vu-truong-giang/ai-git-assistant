import { GitDiff } from '../models/GitDiff.model';

export interface IDiffService {
    getDiff(): Promise<GitDiff[]>;
    getFileDiff(filePath: string): Promise<GitDiff>;
    getStagedDiff(): Promise<GitDiff[]>;
    getFileContent(filePath: string, ref: string): Promise<string>;
}