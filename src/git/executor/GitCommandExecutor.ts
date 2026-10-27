import * as cp from 'child_process';

export class GitCommandExecutor {
    constructor(private workspaceRoot: string) {}

    async execute(
        args: string[],
        cwd = this.workspaceRoot,
        env?: NodeJS.ProcessEnv
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const childProcess = cp.spawn('git', args, {
                cwd,
                env: env ? { ...process.env, ...env } : process.env
            });
            let stdout = '';
            let stderr = '';

            childProcess.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            childProcess.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            childProcess.on('close', (code: number | null) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Git command failed with exit code ${code}: ${stderr}`));
                }
            });

            childProcess.on('error', (err: Error) => {
                reject(new Error(`Failed to spawn git command: ${err.message}`));
            });
        });
    }
}