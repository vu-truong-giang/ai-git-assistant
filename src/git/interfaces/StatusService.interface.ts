import { GitFileStatus } from '../models/GitFileStatus.model';

export interface IStatusService {
    getStatus(): Promise<GitFileStatus[]>;
    getStagedFiles(): Promise<GitFileStatus[]>;
    getUnstagedFiles(): Promise<GitFileStatus[]>;
    getUntrackedFiles(): Promise<GitFileStatus[]>;
}