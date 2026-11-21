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

    const parts = files.map(file => {
        const headerLine = file.text.split('\n', 1)[0];
        const summary = `+${file.additions} -${file.deletions}`;

        if (
            matchesAnyGlob(file.path, sensitive) ||
            (file.oldPath && matchesAnyGlob(file.oldPath, sensitive))
        ) {
            omitted.push({ path: file.path, reason: 'sensitive' });
            return {
                path: file.path,
                flexible: false,
                text: `${headerLine}\n[content omitted: sensitive file (${file.status})]\n`
            };
        }

        if (matchesAnyGlob(file.path, excluded)) {
            omitted.push({ path: file.path, reason: 'excluded' });
            return {
                path: file.path,
                flexible: false,
                text: `${headerLine}\n[content omitted: generated/lock file, ${summary}]\n`
            };
        }

        if (file.binary) {
            omitted.push({ path: file.path, reason: 'binary' });
            return {
                path: file.path,
                flexible: false,
                text: `${headerLine}\n[binary file ${file.status}]\n`
            };
        }

        let text = file.text;

        if (options.redactSecrets !== false) {
            const result = redactSecrets(text);
            text = result.text;
            redactions += result.count;
        }

        return { path: file.path, flexible: true, text };
    });

    const budget = Math.max(0, Math.floor(options.maxChars));
    let remaining = budget;
    const output: string[] = [];

    for (let index = 0; index < parts.length; index++) {
        if (remaining <= 0) {
            if (parts[index].flexible) {
                truncatedFiles.push(parts[index].path);
            }
            continue;
        }

        const part = parts[index];
        const remainingParts = parts.length - index;
        const share = Math.min(
            remaining,
            Math.max(1, Math.floor(remaining / remainingParts))
        );

        let text = part.text;

        if (text.length > share) {
            text = truncateWithinBudget(text, share);
            if (part.flexible) {
                truncatedFiles.push(part.path);
            }
        }

        output.push(text);
        remaining -= text.length;
    }

    return {
        text: output.join('').slice(0, budget),
        files,
        omitted,
        truncatedFiles,
        redactions,
        originalChars: rawDiff.length
    };
}

function truncateWithinBudget(text: string, maxChars: number): string {
    if (maxChars <= 0) return '';
    if (text.length <= maxChars) return text;

    const lines = text.split('\n');
    const kept: string[] = [];
    let usedChars = 0;

    for (const line of lines) {
        const nextSize = line.length + (kept.length > 0 ? 1 : 0);

        if (usedChars + nextSize > maxChars) {
            break;
        }

        kept.push(line);
        usedChars += nextSize;
    }

    const droppedLines = lines.length - kept.length;
    const marker = `[truncated: ${droppedLines} more line(s) not shown]`;

    while (kept.length > 0) {
        const result = `${kept.join('\n')}\n${marker}`;
        if (result.length <= maxChars) {
            return result;
        }
        kept.pop();
    }

    return marker.slice(0, maxChars);
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
