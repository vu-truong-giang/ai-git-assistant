import { exec } from 'child_process';
import { promisify } from 'util';

import {
    GitRepositoryInfo,
    IGitRepositoryService
} from './../interfaces/IGitRepositoryService';

const execAsync = promisify(exec);

export class GitRepositoryService
    implements IGitRepositoryService {

    async checkRepository(
        workspacePath: string
    ): Promise<GitRepositoryInfo> {

        try {
            const { stdout } = await execAsync(
                'git rev-parse --show-toplevel',
                {
                    cwd: workspacePath
                }
            );

            const repositoryRoot = stdout.trim();

            if (!repositoryRoot) {
                return {
                    isGitRepository: false
                };
            }

            return {
                isGitRepository: true,
                repositoryRoot
            };

        } catch {
            return {
                isGitRepository: false
            };
        }
    }
}