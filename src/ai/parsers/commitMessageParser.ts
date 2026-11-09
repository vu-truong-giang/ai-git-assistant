import { AIError } from '../models/AIError.model';

const MAX_SUBJECT = 72;

/**
 * Cleans an AI answer into a commit message: removes code fences, labels and
 * wrapping quotes, normalises blank lines and guarantees "subject\n\nbody".
 */
export function parseCommitMessage(raw: string): string {
    let text = raw.replace(/\r\n/g, '\n').trim();

    const fenced = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(text);
    if (fenced) {
        text = fenced[1].trim();
    }
    // "Commit message:", "**Commit message:**", "**Suggested commit message**:" ...
    text = text.replace(/^(?:\*\*)?(?:suggested\s+)?commit message\s*(?:\*\*)?\s*:\s*(?:\*\*)?\s*/i, '');
    if (/^(["'`])[\s\S]*\1$/.test(text) && text.length > 1) {
        text = text.slice(1, -1).trim();
    }

    const lines = text.split('\n').map(line => line.trimEnd());
    while (lines.length && !lines[0].trim()) {
        lines.shift();
    }
    if (!lines.length || !lines[0].trim()) {
        throw new AIError('INVALID_RESPONSE', 'The AI returned an empty commit message.', 'ai');
    }

    let subject = lines[0].trim().replace(/^#+\s*/, '').replace(/\.$/, '');
    if (subject.length > MAX_SUBJECT * 2) {
        // A paragraph instead of a subject line: cut at a word boundary.
        subject = subject.slice(0, MAX_SUBJECT).replace(/\s+\S*$/, '');
    }

    const body = lines.slice(1).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return body ? `${subject}\n\n${body}` : subject;
}
