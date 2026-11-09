const cache = new Map<string, RegExp>();

/**
 * Minimal glob matcher for repository paths (forward slashes).
 * Supports `**`, `*`, `?`. A pattern without "/" matches the file name in any folder,
 * like .gitignore does.
 */
export function matchesGlob(filePath: string, pattern: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const target = pattern.includes('/')
        ? normalizedPath
        : normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1);
    return toRegExp(pattern).test(target);
}

export function matchesAnyGlob(filePath: string, patterns: readonly string[]): boolean {
    return patterns.some(pattern => pattern.trim() && matchesGlob(filePath, pattern.trim()));
}

function toRegExp(pattern: string): RegExp {
    let regex = cache.get(pattern);
    if (regex) {
        return regex;
    }
    let source = '';
    const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
    for (let i = 0; i < normalized.length; i++) {
        const char = normalized[i];
        if (char === '*') {
            if (normalized[i + 1] === '*') {
                // "**/" matches zero or more directories; a trailing "**" matches everything.
                if (normalized[i + 2] === '/') {
                    source += '(?:.*/)?';
                    i += 2;
                } else {
                    source += '.*';
                    i += 1;
                }
            } else {
                source += '[^/]*';
            }
        } else if (char === '?') {
            source += '[^/]';
        } else {
            source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
    }
    regex = new RegExp(`^${source}$`, 'i');
    cache.set(pattern, regex);
    return regex;
}
