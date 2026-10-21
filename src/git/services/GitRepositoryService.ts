
import * as path from 'path';
import { GitCommandExecutor } from './../executor/GitCommandExecutor';
import { IGitRepositoryService } from './../interfaces/IGitRepositoryService';
import { GitRepository, GitRepositoryInfo } from '../models/GitRepository.model';
import { GitCommit, GitAuthor } from '../models/GitCommit.model';
import { GitRemote, GitRemoteType } from '../models/GitRemote.model';

export class GitRepositoryService implements IGitRepositoryService {
    constructor(
        private readonly executor: GitCommandExecutor
    ) {}

    async checkRepository(
        workspacePath: string
    ): Promise<GitRepositoryInfo> {
        try {
            const result = await this.executor.execute(
                ['rev-parse', '--show-toplevel'],
                workspacePath
            );
            const repositoryRoot = result.trim();
            if (!repositoryRoot) {
                return {
                    isGitRepository: false
                };
            }
            return {
                isGitRepository: true,
                repositoryRoot
            };
        } catch (error) {
            console.error('Failed to check Git repository', error);
            return {
                isGitRepository: false
            };
        }
    }

    async getRepository(): Promise<GitRepository> {
        try {
            const rootPath = await this.getRootPath();
            const [currentBranch, isClear, commits, remotes] = await Promise.all([
                this.executor.execute(['rev-parse', '--abbrev-ref', 'HEAD']),
                this.executor.execute(['status', '--porcelain']),
                this.getRecentCommits(),
                this.getRemotes()
            ]);

            return {
                name: path.basename(rootPath),
                rootPath,
                currentBranch: currentBranch.trim(),
                isClear: isClear.trim().length === 0,
                commits,
                remotes
            };
        } catch (error) {
            console.error('Failed to get Git repository information', error);
            throw error;
        }
    }

    async getRootPath(): Promise<string> {
        try {
            const rootPath = (await this.executor.execute([
                'rev-parse', '--show-toplevel'
            ])).trim();

            if (!rootPath) {
                throw new Error('Git returned an empty repository root path');
            }

            return rootPath;
        } catch (error) {
            console.error('Failed to get Git repository root path', error);
            throw error;
        }
    }

    async initializeRepository(): Promise<void> {
        try {
            await this.executor.execute(['init']);
        } catch (error) {
            console.error('Failed to initialize Git repository', error);
            throw error;
        }
    }

    async isRepositoryInitialized(): Promise<boolean> {
        try {
            const result = await this.executor.execute([
                'rev-parse', '--is-inside-work-tree'
            ]);
            return result.trim() === 'true';
        } catch (error) {
            console.error('Failed to check whether Git repository is initialized', error);
            return false;
        }
    }

    private async getRecentCommits(): Promise<GitCommit[]> {
        const separator = '|__|';
        const format = [
            '%H',
            '%h',
            '%an',
            '%ae',
            '%cn',
            '%ce',
            '%aI',
            '%s'
        ].join(separator);
        const stdout = await this.executor.execute([
            'log', '--all', '-10', `--format=${format}`
        ]);

        return stdout.split(/\r?\n/).filter(line => line.length > 0).map(line => {
            const [hash, shortHash, authorName, authorEmail, committerName, committerEmail, date, message] =
                line.split(separator);
            const author: GitAuthor = { name: authorName, email: authorEmail };
            const commitor: GitAuthor = { name: committerName, email: committerEmail };

            return {
                hash,
                shortHash,
                author,
                commitor,
                date: new Date(date),
                message
            };
        });
    }

    private async getRemotes(): Promise<GitRemote[]> {
        const stdout = await this.executor.execute(['remote', '-v']);
        const remoteMap = new Map<string, { fetchUrl: string; pushUrl: string }>();

        for (const line of stdout.split(/\r?\n/)) {
            const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
            if (!match) {
                continue;
            }

            const [, name, url, direction] = match;
            const urls = remoteMap.get(name) ?? { fetchUrl: '', pushUrl: '' };
            if (direction === 'fetch') {
                urls.fetchUrl = url;
            } else {
                urls.pushUrl = url;
            }
            remoteMap.set(name, urls);
        }

        return Array.from(remoteMap, ([name, urls]) => ({
            name,
            type: this.getRemoteType(name),
            ...urls
        }));
    }

    private getRemoteType(name: string): GitRemoteType {
        return name === 'upstream' ? 'upstream' : 'origin';
    }
}