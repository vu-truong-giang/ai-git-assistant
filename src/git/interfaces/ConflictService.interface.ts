import { GitConflict } from '../models/GitConflict.model';

export interface IConflictService {
    getConflicts(): Promise<GitConflict[]>;
    hasConflicts(): Promise<boolean>;

    resolveConflict(
        filePath: string, resolution: 'ours' | 'theirs'
    ): Promise<void>;
}
