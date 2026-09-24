import { IGitService } from './interfaces/IGitService.service';
import { IRepositoryService } from './interfaces/RepositoryService.interface';  
import { IStatusService } from './interfaces/StatusService.interface';  
import { IDiffService } from './interfaces/DiffService.interface';
import { IBranchService } from './interfaces/BranchService.interface';
import { ICommitService } from './interfaces/CommitService.interface';
import { IRemoteService } from './interfaces/RemoteService.interface';
import { IConflictService } from './interfaces/ConflictService.interface';


export class GitService implements IGitService {
    constructor(
        public readonly repository: IRepositoryService,
        public readonly status: IStatusService,  
        public readonly diff: IDiffService,
        public readonly branch: IBranchService,
        public readonly commit: ICommitService,
        public readonly remote: IRemoteService,
        public readonly conflict: IConflictService
    ) {}
}