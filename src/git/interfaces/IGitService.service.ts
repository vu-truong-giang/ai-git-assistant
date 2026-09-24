import { IGitRepositoryService } from './IGitRepositoryService';
import { IStatusService } from './StatusService.interface';
import { IDiffService } from './DiffService.interface';
import { IBranchService } from './BranchService.interface';
import { ICommitService } from './CommitService.interface';
import { IRemoteService } from './RemoteService.interface';
import { IConflictService } from './ConflictService.interface';

export interface IGitService {
    readonly repository: IGitRepositoryService;
    readonly status: IStatusService;
    readonly diff: IDiffService;
    readonly branch: IBranchService;
    readonly commit: ICommitService;
    readonly remote: IRemoteService;
    readonly conflict: IConflictService;
}