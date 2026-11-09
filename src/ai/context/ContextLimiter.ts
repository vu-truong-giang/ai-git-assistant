import { DiffFileSection, parseDiffSections } from './diffUtils';
import { matchesAnyGlob } from './glob';
import { redactSecrets } from './SecretRedactor';

/** Files whose content must never leave the machine. */
export const SENSITIVE_FILE_PATTERNS: readonly string[] = [
    '.env', '.env.*', '*.pem', '*.key', '*.p12', '*.pfx', '*.jks', '*.keystore',
    'id_rsa', 'id_rsa.*', 'id_ed25519', 'id_ed25519.*', '.npmrc', '.pypirc', '*.kdbx'
];

/** Generated / noisy files that waste the context budget. Overridable in settings. */
export const DEFAULT_EXCLUDE_PATTERNS: readonly string[] = [
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'Cargo.lock',
    'poetry.lock', 'Gemfile.lock', 'go.sum', '*.min.js', '*.min.css', '*.map',
    'dist/**', 'out/**', 'build/**', 'node_modules/**'
];

export interface DiffLimitOptions {
    maxChars: number;
    excludePatterns?: readonly string[];
    sensitivePatterns?: readonly string[];
    redactSecrets?: boolean;
}

export type OmitReason = 'excluded' | 'sensitive' | 'binary';

export interface LimitedDiff {
    /** Diff text that fits in maxChars (plus short placeholders). */
    text: string;
    /** Every file in the original diff, for statistics. */
    files: DiffFileSection[];
    omitted: { path: string; reason: OmitReason }[];
    truncatedFiles: string[];
    redactions: number;
    originalChars: number;
}

const MIN_SHARE = 400;

/**
 * Makes a diff safe and small enough to send to the AI:
 *  1. drops sensitive files entirely and replaces lock/generated/binary files with a one-line note;
 *  2. masks credentials;
 *  3. splits the remaining budget fairly between files (small files stay whole,
 *     big files are cut), so one huge file cannot crowd out all the others.
 */
export function limitDiff(rawDiff: string, options: DiffLimitOptions): LimitedDiff {
    const files = parseDiffSections(rawDiff);
    const omitted: LimitedDiff['omitted'] = [];
    const truncatedFiles: string[] = [];
    let redactions = 0;

    const sensitive = options.sensitivePatterns ?? SENSITIVE_FILE_PATTERNS;
    const excluded = options.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;

    // 1. Classify each file: fixed placeholder text, or content competing for the budget.
    const parts: { text: string; flexible: boolean; path: string }[] = files.map(file => {
        const headerLine = file.text.split('\n', 1)[0];
        const summary = `+${file.additions} -${file.deletions}`;
        if (matchesAnyGlob(file.path, sensitive) || (file.oldPath && matchesAnyGlob(file.oldPath, sensitive))) {
            omitted.push({ path: file.path, reason: 'sensitive' });
            return { path: file.path, flexible: false, text: `${headerLine}\n[content omitted: sensitive file (${file.status})]\n` };
        }
        if (matchesAnyGlob(file.path, excluded)) {
            omitted.push({ path: file.path, reason: 'excluded' });
            return { path: file.path, flexible: false, text: `${headerLine}\n[content omitted: generated/lock file, ${summary}]\n` };
        }
        if (file.binary) {
            omitted.push({ path: file.path, reason: 'binary' });
            return { path: file.path, flexible: false, text: `${headerLine}\n[binary file ${file.status}]\n` };
        }
        let text = file.text;
        if (options.redactSecrets !== false) {
            const result = redactSecrets(text);
            text = result.text;
            redactions += result.count;
        }
        return { path: file.path, flexible: true, text };
    });

    // 2. Water-filling: process files from smallest to largest, each gets at most an equal share.
    const fixedChars = parts.filter(part => !part.flexible).reduce((sum, part) => sum + part.text.length, 0);
    let remaining = Math.max(0, options.maxChars - fixedChars);
    const flexible = parts
        .map((part, index) => ({ part, index }))
        .filter(item => item.part.flexible)
        .sort((a, b) => a.part.text.length - b.part.text.length);

    flexible.forEach((item, position) => {
        const share = Math.max(MIN_SHARE, Math.floor(remaining / (flexible.length - position)));
        if (item.part.text.length > share) {
            item.part.text = truncateLines(item.part.text, share);
            truncatedFiles.push(item.part.path);
        }
        remaining = Math.max(0, remaining - item.part.text.length);
    });

    return {
        text: parts.map(part => part.text).join(''),
        files,
        omitted,
        truncatedFiles,
        redactions,
        originalChars: rawDiff.length
    };
}

/** Truncates at a line boundary and says how much was cut. */
export function truncateLines(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
        return text;
    }
    const lines = text.split('\n');
    const kept: string[] = [];
    let size = 0;
    for (const line of lines) {
        if (size + line.length + 1 > maxChars && kept.length > 0) {
            break;
        }
        kept.push(line.length > maxChars ? `${line.slice(0, maxChars)}…` : line);
        size += line.length + 1;
    }
    const dropped = lines.length - kept.length;
    return `${kept.join('\n')}\n... [truncated: ${dropped} more line(s) not shown]\n`;
}

/** Plain text (non-diff) limiter, e.g. for file content or commit lists. */
export function limitText(text: string, maxChars: number): { text: string; truncated: boolean } {
    if (text.length <= maxChars) {
        return { text, truncated: false };
    }
    return { text: truncateLines(text, maxChars), truncated: true };
}
