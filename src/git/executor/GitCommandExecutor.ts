
import * as cp from 'child_process';

export interface GitCommandOptions {
    timeoutMs?: number;
    maxOutputBytes?: number;
    signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const KILL_GRACE_MS = 1_000;

export class GitCommandExecutor {
    constructor(private readonly workspaceRoot: string) {}

    async execute(
        args: string[],
        cwd = this.workspaceRoot,
        env?: NodeJS.ProcessEnv,
        options: GitCommandOptions = {}
    ): Promise<string> {
        if (options.signal?.aborted) {
            throw createAbortError();
        }

        const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        const maxOutputBytes = Math.max(
            1_024,
            options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
        );

        return new Promise<string>((resolve, reject) => {
            const child = cp.spawn('git', args, {
                cwd,
                env: env ? { ...process.env, ...env } : process.env,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';
            let stdoutBytes = 0;
            let stderrBytes = 0;
            let settled = false;
            let timedOut = false;
            let outputExceeded = false;
            let killTimer: ReturnType<typeof setTimeout> | undefined;

            const cleanup = (): void => {
                clearTimeout(timeoutTimer);
                options.signal?.removeEventListener('abort', onAbort);
            };

            const resolveOnce = (value: string): void => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            };

            const rejectOnce = (error: Error): void => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(error);
            };

            const terminate = (): void => {
                if (child.killed) return;

                try {
                    child.kill('SIGTERM');
                } catch {
                    // The process may already have exited.
                }

                killTimer = setTimeout(() => {
                    if (child.exitCode === null) {
                        try {
                            child.kill('SIGKILL');
                        } catch {
                            // Ignore an already exited process.
                        }
                    }
                }, KILL_GRACE_MS);
            };

            const onAbort = (): void => {
                terminate();
                rejectOnce(createAbortError());
            };

            const timeoutTimer = setTimeout(() => {
                timedOut = true;
                terminate();
                rejectOnce(
                    new Error(`Git command timed out after ${timeoutMs} ms: git ${args.join(' ')}`)
                );
            }, timeoutMs);

            options.signal?.addEventListener('abort', onAbort, { once: true });

            child.stdout.on('data', (data: Buffer) => {
                if (settled || outputExceeded) return;

                const remaining = maxOutputBytes - stdoutBytes;
                if (data.length > remaining) {
                    if (remaining > 0) {
                        stdout += data.subarray(0, remaining).toString('utf8');
                        stdoutBytes += remaining;
                    }

                    outputExceeded = true;
                    terminate();
                    rejectOnce(
                        new Error(
                            `Git output exceeded the ${maxOutputBytes} byte limit: git ${args.join(' ')}`
                        )
                    );
                    return;
                }

                stdout += data.toString('utf8');
                stdoutBytes += data.length;
            });

            child.stderr.on('data', (data: Buffer) => {
                if (stderrBytes >= MAX_STDERR_BYTES) return;

                const remaining = MAX_STDERR_BYTES - stderrBytes;
                const chunk = data.subarray(0, remaining);
                stderr += chunk.toString('utf8');
                stderrBytes += chunk.length;
            });

            child.on('error', (error: Error) => {
                rejectOnce(new Error(`Failed to start Git: ${error.message}`));
            });

            child.on('close', (code: number | null) => {
                if (killTimer) {
                    clearTimeout(killTimer);
                    killTimer = undefined;
                }

                if (settled) return;
                if (settled) return;

                if (timedOut) {
                    rejectOnce(new Error(`Git command timed out: git ${args.join(' ')}`));
                } else if (outputExceeded) {
                    rejectOnce(new Error(`Git output exceeded ${maxOutputBytes} bytes.`));
                } else if (code === 0) {
                    resolveOnce(stdout);
                } else {
                    rejectOnce(
                        new Error(
                            `Git command failed with exit code ${code}: ${stderr.trim()}`
                        )
                    );
                }
            });
        });
    }
}

function createAbortError(): Error {
    const error = new Error('Git command was cancelled.');
    error.name = 'AbortError';
    return error;
}
