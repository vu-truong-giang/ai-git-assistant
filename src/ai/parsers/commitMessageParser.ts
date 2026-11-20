
import { AIError } from '../models/AIError.model';

const MAX_SUBJECT = 72;

export function parseCommitMessage(raw: string): string {
    let text = raw.replace(/\r\n/g, '\n').trim();

    // Remove a surrounding Markdown code fence.
    const fenced = /^```[a-z]*\s*\n([\s\S]*?)\n?```$/i.exec(text);
    if (fenced) {
        text = fenced[1].trim();
    }

    // Remove common labels.
    text = text.replace(
        /^(?:\*\*)?(?:suggested\s+)?commit message\s*(?:\*\*)?\s*:\s*(?:\*\*)?\s*/i,
        ''
    );

    // Remove wrapping quotes.
    if (/^(["'`])[\s\S]*\1$/.test(text) && text.length > 1) {
        text = text.slice(1, -1).trim();
    }

    const lines = text
        .split('\n')
        .map(line => line.trimEnd());

    while (lines.length && !lines[0].trim()) {
        lines.shift();
    }

    if (!lines.length || !lines[0].trim()) {
        throw new AIError(
            'INVALID_RESPONSE',
            'The AI returned an empty commit message.',
            'ai'
        );
    }

    let subject = lines[0]
        .trim()
        .replace(/^#+\s*/, '')
        .replace(/\.$/, '')
        .trim();

    if (!subject) {
        throw new AIError(
            'INVALID_RESPONSE',
            'The AI returned an invalid commit subject.',
            'ai'
        );
    }

    if (subject.length > MAX_SUBJECT) {
        const candidate = subject
            .slice(0, MAX_SUBJECT)
            .replace(/\s+\S*$/, '')
            .trim();

        subject = candidate || subject.slice(0, MAX_SUBJECT);
    }

    const body = lines
        .slice(1)
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return body
        ? `${subject}\n\n${body}`
        : subject;
}
