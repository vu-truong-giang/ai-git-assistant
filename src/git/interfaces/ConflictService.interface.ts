import { GitConflict } from '../models/GitConflict.model';

export interface ConflictService {
    getConflicts(): Promise<GitConflict[]>;
    hasConflicts(): Promise<boolean>;

    resolveConflict(
        filePath: string, resolution: 'ours' | 'theirs'
    ): Promise<void>;
}