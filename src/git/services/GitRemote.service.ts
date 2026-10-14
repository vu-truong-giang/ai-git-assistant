import { IRemoteService } from '../interfaces/RemoteService.interface';
import { GitRemote, GitRemoteType } from '../models/GitRemote.model';
import { GitCommandExecutor } from '../executor/GitCommandExecutor';

export class GitRemoteService implements IRemoteService {
    constructor(private executor: GitCommandExecutor) {}

    async getRemotes(): Promise<GitRemote[]> {
        try {
            const stdout = await this.executor.execute(['remote', '-v']);
            if (!stdout) {
                return [];
            }

            const remoteMap = new Map<string, { fetchUrl: string; pushUrl: string }>();
            const lines = stdout.split('\n');

            for (const line of lines) {
                if (line.trim().length === 0) continue;

                const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
                if (!match) continue;

                const [, name, url, type] = match;

                if (!remoteMap.has(name)) {
                    remoteMap.set(name, { fetchUrl: '', pushUrl: '' });
                }

                const entry = remoteMap.get(name)!;
                if (type === 'fetch') {
                    entry.fetchUrl = url;
                } else {
                    entry.pushUrl = url;
                }
            }

            const remotes: GitRemote[] = [];
            for (const [name, urls] of remoteMap) {
                remotes.push({
                    name,
                    type: this.inferRemoteType(name),
                    fetchUrl: urls.fetchUrl,
                    pushUrl: urls.pushUrl
                });
            }

            return remotes;
        } catch (error) {
            console.error('Failed to get remotes', error);
            return [];
        }
    }

    async fetch(remote?: string): Promise<GitRemote[]> {
        try {
            const args = ['fetch'];
            if (remote) {
                args.push(remote);
            } else {
                args.push('--all');
            }
            await this.executor.execute(args);
            return await this.getRemotes();
        } catch (error) {
            console.error('Failed to fetch', error);
            throw error;
        }
    }

    async pull(): Promise<GitRemote[]> {
        try {
            await this.executor.execute(['pull']);
            return await this.getRemotes();
        } catch (error) {
            console.error('Failed to pull', error);
            throw error;
        }
    }

    async push(): Promise<GitRemote[]> {
        try {
            await this.executor.execute(['push']);
            return await this.getRemotes();
        } catch (error) {
            console.error('Failed to push', error);
            throw error;
        }
    }


    private inferRemoteType(name: string): GitRemoteType {
        if (name === 'upstream') {
            return 'upstream';
        }
        return 'origin';
    }
}
