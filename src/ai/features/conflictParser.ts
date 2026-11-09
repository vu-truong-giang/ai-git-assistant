export interface ConflictHunk {
    index: number;
    /** 0-based line of "<<<<<<<". */
    startLine: number;
    /** 0-based line of ">>>>>>>". */
    endLine: number;
    oursLabel: string;
    theirsLabel: string;
    ours: string;
    base?: string;
    theirs: string;
    contextBefore: string;
    contextAfter: string;
}

export interface ParsedConflictFile {
    lines: string[];
    eol: '\n' | '\r\n';
    hunks: ConflictHunk[];
}

/** Finds every conflict block (supports diff3 "|||||||" base sections). */
export function parseConflictFile(content: string, contextLines = 12): ParsedConflictFile {
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);
    const hunks: ConflictHunk[] = [];

    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('<<<<<<<')) {
            continue;
        }
        const start = i;
        const ours: string[] = [];
        const base: string[] = [];
        const theirs: string[] = [];
        let section: 'ours' | 'base' | 'theirs' = 'ours';
        let hasBase = false;
        let end = -1;
        let theirsLabel = '';

        for (let j = i + 1; j < lines.length; j++) {
            const line = lines[j];
            if (line.startsWith('<<<<<<<')) {
                throw new Error(`Nested conflict markers at line ${j + 1}.`);
            }
            if (line.startsWith('|||||||') && section === 'ours') {
                section = 'base';
                hasBase = true;
            } else if (line === '=======' && section !== 'theirs') {
                section = 'theirs';
            } else if (line.startsWith('>>>>>>>') && section === 'theirs') {
                end = j;
                theirsLabel = line.slice(7).trim();
                break;
            } else {
                (section === 'ours' ? ours : section === 'base' ? base : theirs).push(line);
            }
        }
        if (end < 0) {
            throw new Error(`Conflict starting at line ${start + 1} is not closed.`);
        }

        hunks.push({
            index: hunks.length,
            startLine: start,
            endLine: end,
            oursLabel: lines[start].slice(7).trim(),
            theirsLabel,
            ours: ours.join('\n'),
            base: hasBase ? base.join('\n') : undefined,
            theirs: theirs.join('\n'),
            contextBefore: lines.slice(Math.max(0, start - contextLines), start)
                .filter(line => !isMarker(line)).join('\n'),
            contextAfter: lines.slice(end + 1, end + 1 + contextLines)
                .filter(line => !isMarker(line)).join('\n')
        });
        i = end;
    }

    return { lines, eol, hunks };
}

/**
 * Replaces each conflict block with its resolution and keeps the file's line endings.
 * Throws if a hunk has no resolution or a resolution still contains markers.
 */
export function applyConflictResolutions(
    parsed: ParsedConflictFile,
    resolutions: ReadonlyMap<number, string>
): string {
    const output: string[] = [];
    let cursor = 0;
    for (const hunk of parsed.hunks) {
        const resolution = resolutions.get(hunk.index);
        if (resolution === undefined) {
            throw new Error(`Missing resolution for conflict ${hunk.index + 1}.`);
        }
        if (resolution.split(/\r?\n/).some(isMarker)) {
            throw new Error(`Resolution for conflict ${hunk.index + 1} still contains conflict markers.`);
        }
        output.push(...parsed.lines.slice(cursor, hunk.startLine));
        if (resolution !== '') {
            output.push(...resolution.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));
        }
        cursor = hunk.endLine + 1;
    }
    output.push(...parsed.lines.slice(cursor));
    return output.join(parsed.eol);
}

function isMarker(line: string): boolean {
    return line.startsWith('<<<<<<<') || line.startsWith('>>>>>>>')
        || line.startsWith('|||||||') || line === '=======';
}
