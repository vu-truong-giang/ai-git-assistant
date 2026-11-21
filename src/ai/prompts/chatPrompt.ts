import { AIMessage } from '../models/AIRequest.model';
import { GitContext } from '../context/GitContext.model';
import { formatGitContext } from '../context/GitContextBuilder';

export function buildChatSystemPrompt(context: GitContext, language: string): string {
    return `You are "AI Git Assistant", an expert in Git and software development embedded in VS Code.
You help the user understand and manage the Git repository described below.

Guidelines:
- Answer in ${language} unless the user clearly writes in another language; then answer in theirs.
- Base answers on the repository context below. If the context does not contain the answer, say so instead of guessing.
- Format answers as Markdown. Put git commands in \`\`\`bash code blocks.
- Before suggesting a destructive command (reset --hard, push --force, clean -fd, branch -D, rebase on shared branches), warn clearly and offer a safer alternative.
- Be concise: short paragraphs and bullet points.

The context is a snapshot taken when the user asked the question.

# Repository context
${formatGitContext(context)}`;
}

/** System prompt + trimmed history + the new question. */
export function buildChatMessages(
    systemPrompt: string,
    history: readonly AIMessage[],
    question: string
): AIMessage[] {
    return [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: question }
    ];
}
