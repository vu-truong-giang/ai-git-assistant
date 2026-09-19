import * as cp from 'child_process';

export class GitCommandExecutor {
    constructor(private workspaceRoot: string) {}

    async execute(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const process = cp.spawn('git', args, { cwd: this.workspaceRoot });
            let stdout = '';
            let stderr = '';

            process.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            process.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Git command failed with exit code ${code}: ${stderr}`));
                }
            });

            process.on('error', (err) => {
                reject(new Error(`Failed to spawn git command: ${err.message}`));
            });
        });
    }
}
