import { GitDiff } from '../models/GitDiff.model';

export interface IDiffService {
    getDiff(): Promise<GitDiff[]>;
    getFileDiff(filePath: string): Promise<GitDiff>;
    getStagedDiff(): Promise<GitDiff[]>;
}