export interface RedactionResult {
    text: string;
    count: number;
}

const REDACTED = '[REDACTED]';

/** Well-known credential formats that are unambiguous on their own. */
const TOKEN_PATTERNS: RegExp[] = [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
    /\bAIza[0-9A-Za-z_-]{35}\b/g,                          // Google API key
    /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g,           // OpenAI / Anthropic
    /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,                     // GitHub tokens
    /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g,
    /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,                      // AWS access key id
    /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,                   // Slack
    /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/gi         // credentials in URLs (user:pass@host)
];

/** `password = "..."`-style assignments; only the value is replaced. */
const ASSIGNMENT_PATTERN =
    /\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*)(["']?)([^\s"'`,;]{6,})\3/gi;

/**
 * Masks credentials before code is sent to an external AI service.
 * Errs on the side of masking: a false positive only hides a value from the AI.
 */
export function redactSecrets(input: string): RedactionResult {
    let count = 0;
    let text = input;

    for (const pattern of TOKEN_PATTERNS) {
        text = text.replace(pattern, match => {
            count++;
            // Keep the "scheme://" part of URL credentials so the diff still reads naturally.
            const url = /^([a-z][a-z0-9+.-]*:\/\/)/i.exec(match);
            return url ? `${url[1]}${REDACTED}@` : REDACTED;
        });
    }

    text = text.replace(ASSIGNMENT_PATTERN, (match, key: string, separator: string, quote: string, value: string) => {
        if (value === REDACTED || /^(?:process\.env|os\.environ|env\(|\$\{|<|\[REDACTED)/.test(value)) {
            return match; // References to env vars are not secrets.
        }
        count++;
        return `${key}${separator}${quote}${REDACTED}${quote}`;
    });

    return { text, count };
}
