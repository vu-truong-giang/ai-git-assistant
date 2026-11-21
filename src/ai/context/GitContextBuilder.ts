import * as fs from 'fs/promises';
import * as path from 'path';
import { IDiffService } from '../../git/interfaces/DiffService.interface';
import { ICommitService } from '../../git/interfaces/CommitService.interface';
import { IBranchService } from '../../git/interfaces/IGitBranchService';
import { IStatusService } from '../../git/interfaces/IGitStatusService';
import { GitFileStatus } from '../../git/models/GitFileStatus.model';
import { computeDiffStats, formatFileSummary } from './diffUtils';
import { GitContext, GitContextCommit, GitContextRequest } from './GitContext.model';
import { AIError } from '../models/AIError.model';
import {
    SENSITIVE_FILE_PATTERNS,
    DEFAULT_EXCLUDE_PATTERNS,
    limitDiff
} from './ContextLimiter';
import { matchesAnyGlob } from './glob';
import { GitCommandOptions } from '../../git/executor/GitCommandExecutor';


const MAX_UNTRACKED_FILES = 10;
const MAX_UNTRACKED_FILE_BYTES = 16 * 1024;
const MAX_UNTRACKED_TOTAL_BYTES = 128 * 1024;
const GIT_DIFF_TIMEOUT_MS = 15_000;
const MAX_GIT_DIFF_BYTES = 1_500_000;

export type ReadWorkspaceFile = (relativePath: string) => Promise<Buffer | undefined>;

/**
 * Collects branch, status, diff and history from the Git services and turns them
 * into a size-limited, secret-redacted context for AI prompts.
 */
export class GitContextBuilder {
    private readonly readFile: ReadWorkspaceFile;

    constructor(
        private readonly status: IStatusService,
        private readonly diff: IDiffService,
        private readonly branch: Pick<IBranchService, 'getCurrentBranch'>,
        private readonly commit: Pick<ICommitService, 'getHistory'>,
        workspaceRoot: string,
        readFile?: ReadWorkspaceFile
    ) {
        this.readFile = readFile ?? (relativePath => readInsideRoot(workspaceRoot, relativePath));
    }

    
    async build(
        request: GitContextRequest,
        signal?: AbortSignal
    ): Promise<GitContext> {
        this.throwIfAborted(signal);

        const contextStarted = Date.now();

        try {
            const [files, branchInfo, commits] = await Promise.all([
                this.status.getStatus(),
                this.branch.getCurrentBranch().catch(() => undefined),
                request.historyLimit
                    ? this.commit.getHistory(
                        request.historyLimit,
                        request.historyRange
                    ).catch(() => [])
                    : Promise.resolve([])
            ]);

            this.throwIfAborted(signal);

            const { scope, range, rawDiff } = await this.collectDiff(
                request,
                files,
                signal
            );

            this.throwIfAborted(signal);

            const diff = limitDiff(rawDiff, {
                maxChars: request.maxChars,
                excludePatterns: request.excludePatterns,
                redactSecrets: request.redactSecrets
            });

            const recentCommits: GitContextCommit[] = commits.map(commit => ({
                shortHash: commit.shortHash,
                message: commit.message,
                author: commit.author.name,
                date: isNaN(commit.date.getTime())
                    ? ''
                    : commit.date.toISOString().slice(0, 10)
            }));

            console.log(
                `[GitContextBuilder] Built context in ${Date.now() - contextStarted} ms; ` +
                `${rawDiff.length} raw chars, ${diff.text.length} context chars`
            );

            return {
                branch: branchInfo?.name ?? 'HEAD',
                trackingBranch: branchInfo?.tracking,
                ahead: branchInfo?.ahead ?? 0,
                behind: branchInfo?.behind ?? 0,
                files,
                diffScope: scope,
                range,
                diff,
                recentCommits
            };
        } catch (error) {
            if (signal?.aborted || isAbortError(error)) {
                throw new AIError(
                    'CANCELLED',
                    'The Git context collection was cancelled.',
                    'git',
                    undefined,
                    error
                );
            }

            throw error;
        }
    }

private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new AIError(
            'CANCELLED',
            'The Git context collection was cancelled.',
            'git'
        );
    }
}


    
    private async collectDiff(
        request: GitContextRequest,
        files: GitFileStatus[],
        signal?: AbortSignal
    ): Promise<{
        scope: GitContext['diffScope'];
        range?: string;
        rawDiff: string;
    }> {
        const requested = request.diff;

        if (requested === 'none') {
            return { scope: 'none', rawDiff: '' };
        }

        if (typeof requested === 'object') {
            const rawDiff = await this.diff.getRawDiff(
                { range: requested.range },
                this.gitExecutionOptions(signal)
            );

            return {
                scope: 'range',
                range: requested.range,
                rawDiff
            };
        }

        const scope = requested === 'auto'
            ? (files.some(file => file.staged) ? 'staged' : 'all')
            : requested;

        if (scope === 'staged') {
            const rawDiff = await this.diff.getRawDiff(
                { staged: true },
                this.gitExecutionOptions(signal)
            );

            return { scope, rawDiff };
        }

        let tracked: string;

        if (scope === 'working') {
            tracked = await this.diff.getRawDiff(
                {},
                this.gitExecutionOptions(signal)
            );
        } else {
            try {
                // HEAD diff includes staged and unstaged tracked changes.
                tracked = await this.diff.getRawDiff(
                    { range: 'HEAD' },
                    this.gitExecutionOptions(signal)
                );
            } catch (error) {
                // Only fall back for a repository without its first commit.
                // Never hide timeout, cancellation or output-limit errors.
                if (!isUnbornHeadError(error)) {
                    throw error;
                }

                const [staged, working] = await Promise.all([
                    this.diff.getRawDiff(
                        { staged: true },
                        this.gitExecutionOptions(signal)
                    ),
                    this.diff.getRawDiff(
                        {},
                        this.gitExecutionOptions(signal)
                    )
                ]);

                tracked = staged + working;
            }
        }

        this.throwIfAborted(signal);

        const untracked = await this.untrackedAsDiff(
            files,
            request.excludePatterns,
            signal
        );

        return {
            scope,
            rawDiff: tracked + untracked
        };
    }

private gitExecutionOptions(signal?: AbortSignal): GitCommandOptions {
    return {
        timeoutMs: GIT_DIFF_TIMEOUT_MS,
        maxOutputBytes: MAX_GIT_DIFF_BYTES,
        signal
    };
}


    /** git diff ignores untracked files, so render them as "new file" diffs. */
    
    private async untrackedAsDiff(
        files: GitFileStatus[],
        customExcludePatterns?: readonly string[],
        signal?: AbortSignal
    ): Promise<string> {
        const excluded = [
            ...DEFAULT_EXCLUDE_PATTERNS,
            ...(customExcludePatterns ?? [])
        ];

        const candidates = files
            .filter(file => file.status === 'untracked')
            .slice(0, MAX_UNTRACKED_FILES);

        const blocks: string[] = [];
        let remainingBytes = MAX_UNTRACKED_TOTAL_BYTES;

        for (const file of candidates) {
            this.throwIfAborted(signal);

            const filePath = file.filePath.replace(/^"|"$/g, '');
            const header =
                `diff --git a/${filePath} b/${filePath}\n` +
                'new file mode 100644\n';

            if (
                matchesAnyGlob(filePath, SENSITIVE_FILE_PATTERNS)
            ) {
                blocks.push(
                    `${header}[content omitted: sensitive file]\n`
                );
                continue;
            }

            if (matchesAnyGlob(filePath, excluded)) {
                blocks.push(
                    `${header}[content omitted: generated/lock file]\n`
                );
                continue;
            }

            if (filePath.endsWith('/')) {
                blocks.push(
                    `${header}[untracked folder; contents not listed]\n`
                );
                continue;
            }

            if (remainingBytes <= 0) {
                blocks.push(
                    `${header}[content omitted: untracked context budget reached]\n`
                );
                continue;
            }

            let content: Buffer | undefined;

            try {
                content = await this.readFile(filePath);
            } catch {
                content = undefined;
            }

            this.throwIfAborted(signal);

            if (!content) {
                blocks.push(
                    `${header}[untracked file could not be read]\n`
                );
                continue;
            }

            if (content.includes(0)) {
                blocks.push(
                    `${header}Binary files /dev/null and b/${filePath} differ\n`
                );
                continue;
            }

            const allowedBytes = Math.min(
                MAX_UNTRACKED_FILE_BYTES,
                remainingBytes
            );

            const truncated = content.length > allowedBytes;
            const text = content
                .subarray(0, allowedBytes)
                .toString('utf8')
                .replace(/\r\n/g, '\n');

            remainingBytes -= Math.min(content.length, allowedBytes);

            const lines = text.endsWith('\n')
                ? text.slice(0, -1).split('\n')
                : text.split('\n');

            const cut = truncated
                ? '\n... [untracked file truncated]\n'
                : '';

            blocks.push(
                `${header}` +
                `--- /dev/null\n` +
                `+++ b/${filePath}\n` +
                `@@ -0,0 +1,${lines.length} @@\n` +
                `${lines.map(line => `+${line}`).join('\n')}` +
                `${cut}\n`
            );
        }

        return blocks.join('');
    }

}

/** Renders the context as Markdown sections for a prompt. */
export function formatGitContext(
    context: GitContext,
    include: { status?: boolean; history?: boolean; diff?: boolean } = { status: true, history: true, diff: true }
): string {
    const sections: string[] = [];
    const tracking = context.trackingBranch
        ? `, tracking ${context.trackingBranch} (ahead ${context.ahead}, behind ${context.behind})`
        : ', no upstream';
    sections.push(`## Repository\nCurrent branch: ${context.branch}${tracking}`);

    if (include.status) {
        const staged = context.files.filter(file => file.staged);
        const unstaged = context.files.filter(file => !file.staged);
        const list = (items: GitFileStatus[]) =>
            items.map(file => `- ${file.status}: ${file.filePath}`).join('\n') || '- (none)';
        sections.push(`## Working tree status\nStaged:\n${list(staged)}\nNot staged:\n${list(unstaged)}`);
    }

    if (include.history && context.recentCommits.length) {
        sections.push(`## Recent commits (newest first)\n${context.recentCommits
            .map(commit => `- ${commit.shortHash} ${commit.date} ${commit.author}: ${commit.message}`)
            .join('\n')}`);
    }

    if (include.diff && context.diffScope !== 'none') {
        const label = context.diffScope === 'range'
            ? `changes in ${context.range}`
            : `${context.diffScope} changes`;
        const stats = computeDiffStats(context.diff.files);
        const notes: string[] = [];
        if (context.diff.truncatedFiles.length) {
            notes.push(`Some files were truncated to fit the size limit: ${context.diff.truncatedFiles.join(', ')}.`);
        }
        if (context.diff.redactions) {
            notes.push(`${context.diff.redactions} secret-looking value(s) were replaced with [REDACTED].`);
        }
        sections.push(
            `## Changed files (${label}): ${stats.files} file(s), +${stats.additions} -${stats.deletions}\n` +
            `${formatFileSummary(context.diff.files) || '(no changes)'}`
        );
        if (context.diff.text.trim()) {
            sections.push(`## Diff\n${notes.map(note => `Note: ${note}`).join('\n')}${notes.length ? '\n' : ''}\`\`\`diff\n${context.diff.text.trimEnd()}\n\`\`\``);
        }
    }
    return sections.join('\n\n');
}


async function readInsideRoot(
    root: string,
    relativePath: string
): Promise<Buffer | undefined> {
    const absolute = path.resolve(root, relativePath);

    const realRoot = await fs.realpath(root);
    const realFile = await fs.realpath(absolute);
    const relative = path.relative(realRoot, realFile);

    // Prevent both lexical traversal and symlink escape.
    if (
        relative.startsWith('..') ||
        path.isAbsolute(relative)
    ) {
        return undefined;
    }

    const stat = await fs.stat(realFile);

    if (!stat.isFile()) {
        return undefined;
    }

    const handle = await fs.open(realFile, 'r');

    try {
        const buffer = Buffer.alloc(
            Math.min(stat.size, MAX_UNTRACKED_FILE_BYTES + 1)
        );

        const { bytesRead } = await handle.read(
            buffer,
            0,
            buffer.length,
            0
        );

        return buffer.subarray(0, bytesRead);
    } finally {
        await handle.close();
    }
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function isUnbornHeadError(error: unknown): boolean {
    const message = error instanceof Error
        ? error.message
        : String(error);

    return /ambiguous argument ['"]?HEAD|unknown revision|bad revision|needed a single revision|not a valid object name/i
        .test(message);
}

