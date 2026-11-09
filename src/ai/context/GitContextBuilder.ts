import * as fs from 'fs/promises';
import * as path from 'path';
import { IDiffService } from '../../git/interfaces/DiffService.interface';
import { ICommitService } from '../../git/interfaces/CommitService.interface';
import { IBranchService } from '../../git/interfaces/IGitBranchService';
import { IStatusService } from '../../git/interfaces/IGitStatusService';
import { GitFileStatus } from '../../git/models/GitFileStatus.model';
import { limitDiff } from './ContextLimiter';
import { computeDiffStats, formatFileSummary } from './diffUtils';
import { GitContext, GitContextCommit, GitContextRequest } from './GitContext.model';

const MAX_UNTRACKED_FILES = 25;
const MAX_UNTRACKED_FILE_BYTES = 64 * 1024;

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

    async build(request: GitContextRequest): Promise<GitContext> {
        // Independent git calls run in parallel.
        const [files, branchInfo, commits] = await Promise.all([
            this.status.getStatus(),
            this.branch.getCurrentBranch().catch(() => undefined),
            request.historyLimit
                ? this.commit.getHistory(request.historyLimit, request.historyRange).catch(() => [])
                : Promise.resolve([])
        ]);

        const { scope, range, rawDiff } = await this.collectDiff(request, files);
        const diff = limitDiff(rawDiff, {
            maxChars: request.maxChars,
            excludePatterns: request.excludePatterns,
            redactSecrets: request.redactSecrets
        });

        const recentCommits: GitContextCommit[] = commits.map(commit => ({
            shortHash: commit.shortHash,
            message: commit.message,
            author: commit.author.name,
            date: isNaN(commit.date.getTime()) ? '' : commit.date.toISOString().slice(0, 10)
        }));

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
    }

    private async collectDiff(
        request: GitContextRequest,
        files: GitFileStatus[]
    ): Promise<{ scope: GitContext['diffScope']; range?: string; rawDiff: string }> {
        const requested = request.diff;
        if (requested === 'none') {
            return { scope: 'none', rawDiff: '' };
        }
        if (typeof requested === 'object') {
            return { scope: 'range', range: requested.range, rawDiff: await this.diff.getRawDiff({ range: requested.range }) };
        }

        const scope = requested === 'auto'
            ? (files.some(file => file.staged) ? 'staged' : 'all')
            : requested;

        if (scope === 'staged') {
            return { scope, rawDiff: await this.diff.getRawDiff({ staged: true }) };
        }

        let tracked: string;
        if (scope === 'working') {
            tracked = await this.diff.getRawDiff();
        } else {
            // Working tree vs HEAD; a repository without commits has no HEAD yet.
            tracked = await this.diff.getRawDiff({ range: 'HEAD' }).catch(async () =>
                (await this.diff.getRawDiff({ staged: true })) + (await this.diff.getRawDiff())
            );
        }
        const untracked = await this.untrackedAsDiff(files);
        return { scope, rawDiff: tracked + untracked };
    }

    /** git diff ignores untracked files, so render them as "new file" diffs. */
    private async untrackedAsDiff(files: GitFileStatus[]): Promise<string> {
        const untracked = files.filter(file => file.status === 'untracked').slice(0, MAX_UNTRACKED_FILES);
        const blocks = await Promise.all(untracked.map(async file => {
            const filePath = file.filePath.replace(/^"|"$/g, '');
            const header = `diff --git a/${filePath} b/${filePath}\nnew file mode 100644\n`;
            if (filePath.endsWith('/')) {
                return `${header}[untracked folder; contents not listed]\n`;
            }
            const content = await this.readFile(filePath).catch(() => undefined);
            if (!content) {
                return `${header}[untracked file could not be read]\n`;
            }
            if (content.includes(0)) {
                return `${header}Binary files /dev/null and b/${filePath} differ\n`;
            }
            const text = content.subarray(0, MAX_UNTRACKED_FILE_BYTES).toString('utf8').replace(/\r\n/g, '\n');
            const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
            const cut = content.length > MAX_UNTRACKED_FILE_BYTES ? '\n... [file larger than 64 KB, rest not shown]' : '';
            return `${header}--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}`).join('\n')}${cut}\n`;
        }));
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

async function readInsideRoot(root: string, relativePath: string): Promise<Buffer | undefined> {
    const absolute = path.resolve(root, relativePath);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return undefined;
    }
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) {
        return undefined;
    }
    return fs.readFile(absolute);
}
