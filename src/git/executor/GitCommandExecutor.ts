import * as cp from 'child_process';

export class GitCommandExecutor {
    constructor(private workspaceRoot: string) {}

    async execute(args: string[], cwd = this.workspaceRoot): Promise<string> {
        return new Promise((resolve, reject) => {
            const process = cp.spawn('git', args, { cwd });
            let stdout = '';
            let stderr = '';

            process.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            process.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            process.on('close', (code: number | null) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Git command failed with exit code ${code}: ${stderr}`));
                }
            });

            process.on('error', (err: Error) => {
                reject(new Error(`Failed to spawn git command: ${err.message}`));
            });
        });
    }
}