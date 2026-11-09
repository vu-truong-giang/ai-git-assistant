import { AIMessage } from '../models/AIRequest.model';
import { GitContext, GitContextCommit } from '../context/GitContext.model';
import { formatGitContext } from '../context/GitContextBuilder';

export function buildHistorySummaryPrompt(
    branch: string,
    commits: GitContextCommit[],
    language: string
): AIMessage[] {
    const system = `You summarise git commit history for developers. Answer in ${language}, as Markdown with these sections (translate the titles to ${language}):

## Overview
2-4 sentences: what the project has been working on in this period.

## Main themes
Group related commits into themes (features, fixes, refactoring, docs, tooling, ...). One bullet per theme with the key commits' short hashes in parentheses.

## Timeline
A few bullets highlighting the most important milestones in chronological order (oldest first).

## Contributors
Who worked on what, briefly.

Only use information present in the commit list. Do not invent details.`;

    const list = commits
        .map(commit => `- ${commit.shortHash} | ${commit.date} | ${commit.author} | ${commit.message}`)
        .join('\n');
    return [
        { role: 'system', content: system },
        { role: 'user', content: `Branch: ${branch}\n${commits.length} most recent commits (newest first):\n${list}` }
    ];
}

export function buildBranchSummaryPrompt(
    context: GitContext,
    baseBranch: string,
    counts: { ahead: number; behind: number },
    language: string
): AIMessage[] {
    const system = `You summarise a git feature branch compared to its base branch, as a reviewer would before a merge. Answer in ${language}, as Markdown with these sections (translate the titles to ${language}):

## Purpose
What this branch is trying to achieve, in 2-3 sentences.

## Key changes
Bullets grouped by area/module.

## Risks & things to check
Possible breaking changes, missing tests, migrations, conflicts with the base branch (it is ${counts.behind} commit(s) behind the base).

## Merge readiness
A short verdict: ready / needs work, with reasons.

## Suggested pull request
A PR title on one line, then a short PR description.

Base everything on the commits and diff provided. If the diff was truncated, say so briefly.`;

    return [
        { role: 'system', content: system },
        {
            role: 'user',
            content: `Branch "${context.branch}" compared to "${baseBranch}": ${counts.ahead} commit(s) ahead, ${counts.behind} behind.\n\n${formatGitContext(context, { status: false, history: true, diff: true })}`
        }
    ];
}
