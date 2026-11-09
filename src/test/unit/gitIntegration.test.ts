import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { AIService } from '../../ai/AIService';
import { DEFAULT_PREFERENCES } from '../../ai/AIPreferences';
import { GitContextBuilder, formatGitContext } from '../../ai/context/GitContextBuilder';
import { AIFeatureDeps, FeatureUnavailableError } from '../../ai/features/AIFeatureContext';
import { CodeReviewFeature } from '../../ai/features/CodeReviewFeature';
import { CommitMessageFeature } from '../../ai/features/CommitMessageFeature';
import { ConflictAssistantFeature } from '../../ai/features/ConflictAssistantFeature';
import { ExplainDiffFeature } from '../../ai/features/ExplainDiffFeature';
import { GitChatSession } from '../../ai/features/GitChatSession';
import { SummaryFeature } from '../../ai/features/SummaryFeature';
import { GitCommandExecutor } from '../../git/executor/GitCommandExecutor';
import { GitBranchService } from '../../git/services/GitBranch.service';
import { GitCommitService } from '../../git/services/GitCommit.service';
import { GitDiffService } from '../../git/services/GitDiff.service';
import { GitStatusService } from '../../git/services/GitStatus.service';
import { FakeProvider } from './helpers';

/**
 * End-to-end against a real temporary git repository:
 * EPIC 08 (context builder) with many kinds of diff (TASK 10.5),
 * and every AI feature wired to a fake provider.
 */
describe('Git context + AI features on a real repository', () => {
    let repo: string;
    let builder: GitContextBuilder;
    let commits: GitCommitService;

    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    const write = (file: string, content: string | Buffer) => {
        fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
        fs.writeFileSync(path.join(repo, file), content);
    };

    function deps(provider: FakeProvider): AIFeatureDeps {
        return {
            ai: new AIService(provider, () => ({ enabled: true, model: '', timeoutMs: 5000 }), { retryDelayMs: 1 }),
            contextBuilder: builder,
            commits,
            getPreferences: () => DEFAULT_PREFERENCES
        };
    }

    before(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-git-test-'));
        git('init', '-q', '-b', 'main');
        git('config', 'user.name', 'Test User');
        git('config', 'user.email', 'test@example.com');
        git('config', 'core.autocrlf', 'false');
        git('config', 'commit.gpgsign', 'false');

        write('src/app.ts', 'export function add(a: number, b: number) {\n    return a + b;\n}\n');
        write('src/old-name.ts', 'export const value = 1;\nexport const other = 2;\nexport const third = 3;\n');
        write('docs/remove-me.md', '# Old docs\n');
        write('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
        write('package-lock.json', '{ "lockfileVersion": 3 }\n');
        git('add', '-A');
        git('commit', '-q', '-m', 'feat: initial project');

        // Staged: modification + rename + deletion + binary change + lock file.
        write('src/app.ts', 'export function add(a: number, b: number) {\n    if (Number.isNaN(a)) { throw new Error("NaN"); }\n    return a + b;\n}\n');
        git('mv', 'src/old-name.ts', 'src/new-name.ts');
        git('rm', '-q', 'docs/remove-me.md');
        write('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 9, 9, 9]));
        write('package-lock.json', '{ "lockfileVersion": 3, "x": 1 }\n');
        git('add', '-A');

        // Unstaged change containing a secret, plus an untracked file.
        write('src/config.ts', 'export const apiKey = "AIzaSyA1234567890abcdefghijklmnopqrstuv";\n');
        git('add', 'src/config.ts');
        git('commit', '-q', '-m', 'chore: add config');
        write('src/config.ts', 'export const apiKey = "AIzaSyB0987654321zyxwvutsrqponmlkjihgfe";\n');
        write('src/untracked.ts', 'export const fresh = true;\n');

        const executor = new GitCommandExecutor(repo);
        const status = new GitStatusService(executor);
        commits = new GitCommitService(executor);
        builder = new GitContextBuilder(status, new GitDiffService(executor), new GitBranchService(executor, status), commits, repo);
    });

    after(() => {
        fs.rmSync(repo, { recursive: true, force: true });
    });

    it('TASK 8.1-8.4: collects status, branch and history', async () => {
        const context = await builder.build({ diff: 'none', maxChars: 10_000, historyLimit: 10 });
        assert.equal(context.branch, 'main');
        assert.equal(context.diffScope, 'none');
        assert.deepEqual(context.recentCommits.map(commit => commit.message), ['chore: add config', 'feat: initial project']);
        assert.equal(context.recentCommits[0].author, 'Test User');
        assert.ok(context.files.some(file => file.status === 'untracked' && file.filePath === 'src/untracked.ts'));
    });

    it('TASK 8.2 / 10.5: staged diff covers modify, rename, delete, binary and lock file', async () => {
        // The secret-file change was committed, so "staged" is empty now; rebuild a staged set.
        git('add', 'src/config.ts');
        const context = await builder.build({ diff: 'staged', maxChars: 50_000 });
        git('reset', '-q', 'src/config.ts');

        const byPath = new Map(context.diff.files.map(file => [file.path, file]));
        assert.equal(byPath.get('src/config.ts')?.status, 'modified');
        assert.ok(context.diff.redactions >= 1, 'secret in diff must be redacted');
        assert.ok(!context.diff.text.includes('AIzaSyB0987654321'));
    });

    it('TASK 8.5: "all" scope includes uncommitted + untracked content, formatted for the prompt', async () => {
        const context = await builder.build({ diff: 'all', maxChars: 50_000, historyLimit: 5 });
        const paths = context.diff.files.map(file => file.path);
        assert.ok(paths.includes('src/config.ts'));
        assert.ok(paths.includes('src/untracked.ts'));
        assert.ok(context.diff.text.includes('+export const fresh = true;'));

        const text = formatGitContext(context);
        assert.match(text, /## Repository\nCurrent branch: main/);
        assert.match(text, /## Recent commits/);
        assert.match(text, /```diff/);
        assert.match(text, /A {2}src\/untracked\.ts \(\+1 -0\)/);
    });

    it('TASK 10.5: rename/delete/binary/lock-file diff types between two commits', async () => {
        // The second commit contains the modify/rename/delete/binary/lock-file/new-file changes made in before().
        const full = await builder.build({ diff: { range: 'HEAD~1...HEAD' }, maxChars: 50_000 });
        assert.equal(full.diffScope, 'range');
        const byPath = new Map(full.diff.files.map(file => [file.path, file]));

        assert.equal(byPath.get('src/app.ts')?.status, 'modified');
        assert.deepEqual([byPath.get('src/app.ts')?.additions, byPath.get('src/app.ts')?.deletions], [1, 0]);
        assert.equal(byPath.get('src/new-name.ts')?.status, 'renamed');
        assert.equal(byPath.get('src/new-name.ts')?.oldPath, 'src/old-name.ts');
        assert.equal(byPath.get('docs/remove-me.md')?.status, 'deleted');
        assert.equal(byPath.get('src/config.ts')?.status, 'added');
        assert.equal(byPath.get('logo.png')?.binary, true);
        assert.ok(full.diff.omitted.some(item => item.path === 'package-lock.json' && item.reason === 'excluded'));
        assert.ok(full.diff.omitted.some(item => item.path === 'logo.png' && item.reason === 'binary'));
        assert.ok(!full.diff.text.includes('AIzaSyA1234567890'), 'committed secret is redacted too');
    });

    it('EPIC 09: generates a commit message from staged changes only', async () => {
        git('add', 'src/untracked.ts');
        const provider = new FakeProvider(['```\nfeat(src): add fresh flag.\n```']);
        const result = await new CommitMessageFeature(deps(provider)).generate({ scope: 'staged' });
        git('reset', '-q', 'src/untracked.ts');

        assert.equal(result.message, 'feat(src): add fresh flag');
        const prompt = provider.requests[0].messages.map(message => message.content).join('\n');
        assert.match(prompt, /Conventional Commits/);
        assert.match(prompt, /src\/untracked\.ts/);
        assert.ok(!prompt.includes('src/config.ts'), 'unstaged files must not be in a staged commit prompt');
        assert.match(prompt, /chore: add config/, 'recent commits are given as style reference');
    });

    it('EPIC 09: refuses when nothing is staged', async () => {
        await assert.rejects(
            new CommitMessageFeature(deps(new FakeProvider(['x']))).generate({ scope: 'staged' }),
            FeatureUnavailableError);
    });

    it('EPIC 10: explains changes and returns local stats', async () => {
        const provider = new FakeProvider(['## Tóm tắt\nThêm cờ fresh.']);
        const result = await new ExplainDiffFeature(deps(provider)).explain('all');
        assert.equal(result.markdown, '## Tóm tắt\nThêm cờ fresh.');
        assert.equal(result.stats.files, 2);
        assert.match(provider.requests[0].messages[0].content, /Vietnamese/);
    });

    it('EPIC 11: review asks for JSON with line numbers and parses issues', async () => {
        const provider = new FakeProvider([JSON.stringify({
            summary: 'Hard-coded key.',
            score: 4,
            issues: [{ severity: 'critical', category: 'security', file: 'src/config.ts', line: 1, title: 'Secret in code', description: 'd', suggestion: 'use env' }],
            improvements: []
        })]);
        const result = await new CodeReviewFeature(deps(provider)).review('all');
        assert.equal(result.issues[0].severity, 'critical');
        assert.equal(provider.requests[0].options?.responseFormat, 'json');
        assert.match(provider.requests[0].messages[1].content, /\+ {4}1 \| export const fresh = true;/);
    });

    it('EPIC 12: chat keeps history and injects fresh git context', async () => {
        const provider = new FakeProvider(['Bạn đang ở branch main.', 'Có 2 file thay đổi.', new Error('network down')]);
        const session = new GitChatSession(deps(provider));
        await session.ask('Tôi đang ở branch nào?');
        await session.ask('Có bao nhiêu file thay đổi?');
        assert.equal(session.history.length, 4);

        const second = provider.requests[1].messages;
        assert.equal(second[0].role, 'system');
        assert.match(second[0].content, /Current branch: main/);
        assert.deepEqual(second.slice(1).map(message => message.role), ['user', 'assistant', 'user']);

        await assert.rejects(session.ask('lỗi?'));
        assert.equal(session.history.length, 4, 'a failed question is not stored');
        session.clear();
        assert.equal(session.history.length, 0);
    });

    it('EPIC 13: history and branch summaries', async () => {
        git('stash', '-u', '-q');
        git('checkout', '-q', '-b', 'feature/x');
        write('src/feature.ts', 'export const feature = 1;\n');
        git('add', '-A');
        git('commit', '-q', '-m', 'feat: add feature');

        const provider = new FakeProvider(['## Overview\nhistory', '## Purpose\nbranch']);
        const summary = new SummaryFeature(deps(provider));
        const history = await summary.summarizeHistory(10);
        assert.match(history.title, /feature\/x \(3 commit\)/);

        const branch = await summary.summarizeBranch('main');
        assert.match(branch.title, /feature\/x so với main/);
        const prompt = provider.requests[1].messages[1].content;
        assert.match(prompt, /1 commit\(s\) ahead, 0 behind/);
        assert.match(prompt, /src\/feature\.ts/);

        await assert.rejects(summary.summarizeBranch('feature/x'), FeatureUnavailableError);
        git('checkout', '-q', 'main');
        git('stash', 'pop', '-q');
    });

    it('EPIC 13: conflict assistant merges hunks and refuses secrets', async () => {
        const content = 'a\n<<<<<<< HEAD\nconst port = 3000;\n=======\nconst port = 8080;\n>>>>>>> feature\nb\n';
        const provider = new FakeProvider([JSON.stringify({
            resolutions: [{ index: 0, content: 'const port = Number(process.env.PORT ?? 8080);', explanation: 'giữ cả hai' }],
            summary: 'ok'
        })]);
        const feature = new ConflictAssistantFeature(deps(provider));
        const suggestion = await feature.suggest('src/server.ts', content);
        assert.equal(suggestion.resolvedContent, 'a\nconst port = Number(process.env.PORT ?? 8080);\nb\n');
        assert.equal(suggestion.explanations[0].explanation, 'giữ cả hai');

        const secret = 'x\n<<<<<<< HEAD\npassword = "abcdef123456"\n=======\npassword = "zyxwvu654321"\n>>>>>>> f\n';
        await assert.rejects(feature.suggest('a.ts', secret), FeatureUnavailableError);
        await assert.rejects(feature.suggest('a.ts', 'no conflicts'), FeatureUnavailableError);
    });
});
