import { AIMessage } from '../models/AIRequest.model';
import { GitContext } from '../context/GitContext.model';
import { annotateDiffWithLineNumbers, computeDiffStats, formatFileSummary } from '../context/diffUtils';

export const REVIEW_SEVERITIES = ['critical', 'major', 'minor', 'info'] as const;
export const REVIEW_CATEGORIES = [
    'bug', 'logic', 'security', 'performance', 'code-smell', 'maintainability', 'style', 'testing'
] as const;

export function buildCodeReviewPrompt(context: GitContext, language: string): AIMessage[] {
    const system = `You are a meticulous senior code reviewer. Review ONLY the changed lines of the diff (lines starting with "+"), using the surrounding lines as context.

Look for, in priority order:
1. Logic errors and bugs: wrong conditions, off-by-one, null/undefined handling, unhandled promise rejections, race conditions, incorrect error handling, broken edge cases. (category "bug" or "logic")
2. Security problems: injection, path traversal, secrets in code, unsafe HTML, missing validation. (category "security")
3. Performance problems. (category "performance")
4. Code smells: duplication, overly long functions, deep nesting, magic numbers, dead code, poor naming, tight coupling. (category "code-smell" or "maintainability")
5. Missing tests or style issues, only when meaningful. (category "testing" or "style")

Each diff line is prefixed with its line number in the NEW file, like "+   42 | code". Use that number for "line". Use null when an issue is not tied to one line.

Respond with a single JSON object and nothing else, matching this TypeScript type:
{
  "summary": string,            // 2-3 sentence overall assessment
  "score": number,              // overall quality 1-10
  "issues": Array<{
    "severity": "critical" | "major" | "minor" | "info",
    "category": ${REVIEW_CATEGORIES.map(category => `"${category}"`).join(' | ')},
    "file": string,             // path exactly as in the diff
    "line": number | null,
    "title": string,            // short, one line
    "description": string,      // what is wrong and why it matters
    "suggestion": string        // concrete fix; may contain a short code snippet
  }>,
  "improvements": string[]      // general suggestions not tied to a specific issue
}

Write all human-readable text (summary, title, description, suggestion, improvements) in ${language}.
Report real problems only; do not pad the list. An empty "issues" array is a valid answer for good code.
Severity guide: critical = data loss, security hole or crash in normal use; major = incorrect behaviour in realistic cases; minor = small bug risk or maintainability issue; info = optional nit.`;

    const stats = computeDiffStats(context.diff.files);
    const notes = context.diff.truncatedFiles.length
        ? `\nNote: these files were truncated to fit the size limit: ${context.diff.truncatedFiles.join(', ')}.`
        : '';
    const user = `Review these ${context.diffScope === 'range' ? `changes in ${context.range}` : `${context.diffScope} changes`} on branch ${context.branch}.
Files (${stats.files}, +${stats.additions} -${stats.deletions}):
${formatFileSummary(context.diff.files)}${notes}

\`\`\`diff
${annotateDiffWithLineNumbers(context.diff.text).trimEnd()}
\`\`\``;

    return [
        { role: 'system', content: system },
        { role: 'user', content: user }
    ];
}
