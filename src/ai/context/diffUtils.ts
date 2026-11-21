export type DiffFileStatus = 'added' | 'deleted' | 'renamed' | 'copied' | 'modified';

export interface DiffFileSection {
    path: string;
    oldPath?: string;
    status: DiffFileStatus;
    binary: boolean;
    modeChanged: boolean;
    additions: number;
    deletions: number;
    /** The full "diff --git ..." block for this file. */
    text: string;
}

export interface DiffStats {
    files: number;
    additions: number;
    deletions: number;
}

/** Splits `git diff` output into one section per file and extracts metadata. */
export function parseDiffSections(rawDiff: string): DiffFileSection[] {
    const normalized = rawDiff.replace(/\r\n/g, '\n');
    return normalized
        .split(/^(?=diff --git )/m)
        .filter(block => block.startsWith('diff --git '))
        .map(parseSection);
}

function parseSection(text: string): DiffFileSection {
    const lines = text.split('\n');
    const header = parseHeaderPaths(lines[0].slice('diff --git '.length));
    let oldPath = header?.oldPath;
    let newPath = header?.newPath;
    let status: DiffFileStatus = 'modified';
    let binary = false;
    let modeChanged = false;
    let additions = 0;
    let deletions = 0;
    let inHunk = false;

    for (const line of lines.slice(1)) {
        if (line.startsWith('@@')) {
            inHunk = true;
            continue;
        }
        if (inHunk) {
            if (line.startsWith('+')) {
                additions++;
            } else if (line.startsWith('-')) {
                deletions++;
            }
            continue;
        }
        if (line.startsWith('new file mode')) {
            status = 'added';
        } else if (line.startsWith('deleted file mode')) {
            status = 'deleted';
        } else if (line.startsWith('rename from ')) {
            status = 'renamed';
            oldPath = unquoteGitPath(line.slice('rename from '.length));
        } else if (line.startsWith('rename to ')) {
            newPath = unquoteGitPath(line.slice('rename to '.length));
        } else if (line.startsWith('copy from ')) {
            status = 'copied';
            oldPath = unquoteGitPath(line.slice('copy from '.length));
        } else if (line.startsWith('copy to ')) {
            newPath = unquoteGitPath(line.slice('copy to '.length));
        } else if (line.startsWith('old mode')) {
            modeChanged = true;
        } else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) {
            binary = true;
        } else if (line.startsWith('--- ') && !line.startsWith('--- /dev/null')) {
            oldPath = stripPrefix(unquoteGitPath(line.slice(4)), 'a/');
        } else if (line.startsWith('+++ ') && !line.startsWith('+++ /dev/null')) {
            newPath = stripPrefix(unquoteGitPath(line.slice(4)), 'b/');
        }
    }

    const path = (status === 'deleted' ? oldPath : newPath) ?? newPath ?? oldPath ?? '(unknown)';
    return {
        path,
        oldPath: status === 'renamed' || status === 'copied' ? oldPath : undefined,
        status,
        binary,
        modeChanged,
        additions,
        deletions,
        text
    };
}

export function computeDiffStats(sections: readonly DiffFileSection[]): DiffStats {
    return sections.reduce<DiffStats>((stats, section) => ({
        files: stats.files + 1,
        additions: stats.additions + section.additions,
        deletions: stats.deletions + section.deletions
    }), { files: 0, additions: 0, deletions: 0 });
}

/** One line per file, e.g. "R  old.ts -> new.ts (+3 -1)". */
export function formatFileSummary(sections: readonly DiffFileSection[]): string {
    const letter: Record<DiffFileStatus, string> = {
        added: 'A', deleted: 'D', renamed: 'R', copied: 'C', modified: 'M'
    };
    return sections.map(section => {
        const name = section.oldPath ? `${section.oldPath} -> ${section.path}` : section.path;
        const detail = section.binary
            ? 'binary'
            : `+${section.additions} -${section.deletions}`;
        const mode = section.modeChanged ? ', mode changed' : '';
        return `${letter[section.status]}  ${name} (${detail}${mode})`;
    }).join('\n');
}

/**
 * Prefixes hunk lines with their line number in the new file so the AI can
 * point at exact lines ("+  42 | code"). Removed lines get no number.
 */
export function annotateDiffWithLineNumbers(diffText: string): string {
    let newLine = 0;
    let inHunk = false;
    return diffText.replace(/\r\n/g, '\n').split('\n').map(line => {
        if (line.startsWith('diff --git ')) {
            inHunk = false;
            return line;
        }
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunk) {
            inHunk = true;
            newLine = parseInt(hunk[1], 10);
            return line;
        }
        if (!inHunk) {
            return line;
        }
        if (line.startsWith('+')) {
            return `+${String(newLine++).padStart(5)} | ${line.slice(1)}`;
        }
        if (line.startsWith('-')) {
            return `-${' '.repeat(5)} | ${line.slice(1)}`;
        }
        if (line.startsWith(' ')) {
            return ` ${String(newLine++).padStart(5)} | ${line.slice(1)}`;
        }
        return line; // "\ No newline at end of file" etc.
    }).join('\n');
}

function parseHeaderPaths(rest: string): { oldPath: string; newPath: string } | undefined {
    if (rest.startsWith('"')) {
        const tokens: string[] = Array.from(rest.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? []);
        const [oldToken, newToken] = tokens;
        if (oldToken !== undefined && newToken !== undefined) {
            return {
                oldPath: stripPrefix(unquoteGitPath(oldToken), 'a/'),
                newPath: stripPrefix(unquoteGitPath(newToken), 'b/')
            };
        }
    }
    // Unquoted: "a/<path> b/<path>". Paths are identical unless renamed, so split in the middle.
    const middle = rest.indexOf(' b/', Math.floor((rest.length - 3) / 2) - 1);
    const split = middle >= 0 ? middle : rest.indexOf(' b/');
    if (split < 0) {
        return undefined;
    }
    return {
        oldPath: stripPrefix(rest.slice(0, split), 'a/'),
        newPath: stripPrefix(rest.slice(split + 1), 'b/')
    };
}

/** Decodes git's C-style quoted paths (e.g. "t\303\251st.txt") into UTF-8. */
export function unquoteGitPath(value: string): string {
    const trimmed = value.replace(/\t.*$/, '');
    if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
        return trimmed;
    }
    const bytes: number[] = [];
    const body = trimmed.slice(1, -1);
    const simple: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 };
    for (let i = 0; i < body.length; i++) {
        const char = body[i];
        if (char !== '\\') {
            bytes.push(...Buffer.from(char, 'utf8'));
            continue;
        }
        const octal = /^[0-7]{3}/.exec(body.slice(i + 1));
        if (octal) {
            bytes.push(parseInt(octal[0], 8));
            i += 3;
        } else {
            const next = body[i + 1] ?? '\\';
            bytes.push(simple[next] ?? next.charCodeAt(0));
            i += 1;
        }
    }
    return Buffer.from(bytes).toString('utf8');
}

function stripPrefix(value: string, prefix: string): string {
    return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}
