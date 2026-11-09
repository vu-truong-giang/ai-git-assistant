import { AIMessage } from '../models/AIRequest.model';
import { GitContext } from '../context/GitContext.model';
import { formatGitContext } from '../context/GitContextBuilder';

export interface CommitPromptOptions {
    language: string;
    style: 'conventional' | 'simple';
    /** Optional hint from the user, e.g. "fixes login bug for ticket #12". */
    hint?: string;
}

const CONVENTIONAL_RULES = `Use the Conventional Commits format:
<type>(<optional scope>): <subject>

Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.
Pick the type that best matches the main purpose of the change. Use a short scope (module/folder name) only when it is obvious.`;

const SIMPLE_RULES = 'Start with a short summary line without any type prefix.';

export function buildCommitMessagePrompt(context: GitContext, options: CommitPromptOptions): AIMessage[] {
    const system = `You are an expert software engineer who writes clear, conventional git commit messages.

${options.style === 'conventional' ? CONVENTIONAL_RULES : SIMPLE_RULES}

Rules:
- Subject line: imperative mood ("add", not "added"), at most 72 characters, no trailing period.
- If the change is more than trivial, add one blank line and then a short body of "- " bullet points explaining WHAT changed and WHY. Wrap lines at 72 characters. Do not repeat the subject.
- Describe only what the diff shows. Do not invent tickets, issue numbers or features.
- Match the style of the repository's recent commits when it is consistent.
- Write the commit message in ${options.language}. Keep code identifiers, file names and the type keyword in their original form.
- Output ONLY the raw commit message: no Markdown, no code fences, no quotes, no explanations.`;

    const hint = options.hint?.trim()
        ? `\n\nAdditional context from the developer: ${options.hint.trim()}`
        : '';

    return [
        { role: 'system', content: system },
        {
            role: 'user',
            content: `Write the commit message for the following ${context.diffScope} changes.${hint}\n\n${formatGitContext(context, { status: false, history: true, diff: true })}`
        }
    ];
}
