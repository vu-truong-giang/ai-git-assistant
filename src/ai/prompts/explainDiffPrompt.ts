import { AIMessage } from '../models/AIRequest.model';
import { GitContext } from '../context/GitContext.model';
import { formatGitContext } from '../context/GitContextBuilder';

export function buildExplainDiffPrompt(context: GitContext, language: string): AIMessage[] {
    const system = `You are a senior engineer explaining code changes to a teammate who has not seen them.
Analyse the diff and answer in ${language}, as Markdown with exactly these sections (translate the section titles to ${language}):

## Summary
2-4 sentences: what the change does and its likely purpose. State the kind of change (feature, bug fix, refactor, docs, tests, config, ...).

## Changes by file
One bullet per file (or group of closely related files): what changed in it and why it matters. Mention renamed, added, deleted and binary files explicitly.

## Impact & risks
Behavioural impact, possible breaking changes, edge cases or follow-up work. Say clearly when there is no significant risk.

Be concrete: refer to functions, classes and files by name. Do not invent changes that are not in the diff.
If parts of the diff were truncated or omitted, say so briefly instead of guessing their content.`;

    return [
        { role: 'system', content: system },
        { role: 'user', content: `Explain these changes.\n\n${formatGitContext(context, { status: false, history: false, diff: true })}` }
    ];
}
