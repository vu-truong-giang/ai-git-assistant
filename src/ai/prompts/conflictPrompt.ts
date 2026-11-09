import { AIMessage } from '../models/AIRequest.model';
import { ConflictHunk } from '../features/conflictParser';

export interface ConflictPromptInput {
    filePath: string;
    hunks: ConflictHunk[];
    /** Short log lines of the two sides, if known. */
    oursLabel: string;
    theirsLabel: string;
    language: string;
}

export function buildConflictPrompt(input: ConflictPromptInput): AIMessage[] {
    const system = `You are an expert at resolving git merge conflicts.
For each conflict you receive the "ours" side (current branch), the "theirs" side (incoming branch), the common "base" when available, and surrounding code.
Produce a resolution that keeps the intent of BOTH sides whenever they are compatible. When they truly contradict, prefer the version that is more complete/correct and explain why.

Rules:
- The resolved content replaces ONLY the conflict block (from <<<<<<< to >>>>>>>), not the surrounding context lines.
- Never include conflict markers (<<<<<<<, =======, >>>>>>>, |||||||) in the resolved content.
- Preserve indentation and code style exactly.
- Do not add comments explaining the merge inside the code.

Respond with a single JSON object and nothing else:
{
  "resolutions": Array<{ "index": number, "content": string, "explanation": string }>,
  "summary": string
}
"content" is the exact replacement text (may be an empty string). Write "explanation" and "summary" in ${input.language}.`;

    const blocks = input.hunks.map(hunk => `### Conflict ${hunk.index}
Context before:
\`\`\`
${hunk.contextBefore}
\`\`\`
Ours (${input.oursLabel}):
\`\`\`
${hunk.ours}
\`\`\`
${hunk.base !== undefined ? `Base (common ancestor):\n\`\`\`\n${hunk.base}\n\`\`\`\n` : ''}Theirs (${input.theirsLabel}):
\`\`\`
${hunk.theirs}
\`\`\`
Context after:
\`\`\`
${hunk.contextAfter}
\`\`\``).join('\n\n');

    return [
        { role: 'system', content: system },
        { role: 'user', content: `File: ${input.filePath}\nResolve all ${input.hunks.length} conflict(s).\n\n${blocks}` }
    ];
}
