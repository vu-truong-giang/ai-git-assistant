/**
 * Small, safe Markdown renderer for AI answers.
 * All input is HTML-escaped first, so model output can never inject markup or scripts;
 * only the constructs below are turned into tags.
 * Supported: headings, paragraphs, fenced code, inline code, bold, italic, links (http/https),
 * unordered/ordered lists (with nesting by indentation), blockquotes, horizontal rules, tables.
 */
export function renderMarkdown(markdown: string): string {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const html: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        const fence = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/.exec(line);
        if (fence) {
            const code: string[] = [];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith(fence[1])) {
                code.push(lines[i]);
                i++;
            }
            i++; // closing fence
            const language = fence[2] ? ` data-lang="${escapeHtml(fence[2])}"` : '';
            html.push(`<pre${language}><code>${escapeHtml(code.join('\n'))}</code></pre>`);
            continue;
        }

        if (!line.trim()) {
            i++;
            continue;
        }

        const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
        if (heading) {
            const level = Math.min(6, heading[1].length);
            html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
            i++;
            continue;
        }

        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
            html.push('<hr>');
            i++;
            continue;
        }

        if (/^\s*>/.test(line)) {
            const quoted: string[] = [];
            while (i < lines.length && /^\s*>/.test(lines[i])) {
                quoted.push(lines[i].replace(/^\s*>\s?/, ''));
                i++;
            }
            html.push(`<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`);
            continue;
        }

        if (isTableStart(lines, i)) {
            const rows: string[][] = [];
            const header = splitRow(lines[i]);
            i += 2;
            while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
                rows.push(splitRow(lines[i]));
                i++;
            }
            html.push(`<table><thead><tr>${header.map(cell => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows
                .map(row => `<tr>${header.map((_, index) => `<td>${renderInline(row[index] ?? '')}</td>`).join('')}</tr>`)
                .join('')}</tbody></table>`);
            continue;
        }

        if (LIST_ITEM.test(line)) {
            const block: string[] = [];
            while (i < lines.length && (LIST_ITEM.test(lines[i]) || (lines[i].trim() && /^\s{2,}/.test(lines[i])))) {
                block.push(lines[i]);
                i++;
            }
            html.push(renderList(block));
            continue;
        }

        const paragraph: string[] = [];
        while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) {
            paragraph.push(lines[i].trim());
            i++;
        }
        html.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
    }

    return html.join('\n');
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function startsBlock(lines: string[], index: number): boolean {
    const line = lines[index];
    return /^\s*(```|~~~)/.test(line) || /^#{1,6}\s/.test(line) || /^\s*>/.test(line)
        || LIST_ITEM.test(line) || isTableStart(lines, index);
}

function isTableStart(lines: string[], index: number): boolean {
    return lines[index].includes('|')
        && index + 1 < lines.length
        && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[index + 1]);
}

function splitRow(line: string): string[] {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

interface ListNode {
    ordered: boolean;
    items: { text: string; children?: ListNode }[];
}

function renderList(block: string[]): string {
    // A block may hold several top-level lists (e.g. "- a" followed by "1. b").
    const html: string[] = [];
    let start = 0;
    while (start < block.length) {
        const indent = (LIST_ITEM.exec(block[start])?.[1] ?? '').length;
        const { node, next } = parseList(block, start, indent);
        html.push(listToHtml(node));
        start = next > start ? next : start + 1;
    }
    return html.join('');
}

function parseList(lines: string[], start: number, indent: number): { node: ListNode; next: number } {
    const first = LIST_ITEM.exec(lines[start]);
    const node: ListNode = { ordered: Boolean(first && /\d/.test(first[2])), items: [] };
    let i = start;
    while (i < lines.length) {
        const match = LIST_ITEM.exec(lines[i]);
        const lineIndent = (match?.[1] ?? /^\s*/.exec(lines[i])?.[0] ?? '').length;
        if (match && lineIndent < indent) {
            break;
        }
        if (match && lineIndent === indent && node.items.length && /\d/.test(match[2]) !== node.ordered) {
            break; // switching between bullet and numbered list starts a new list
        }
        if (match && lineIndent > indent && node.items.length) {
            const child = parseList(lines, i, lineIndent);
            node.items[node.items.length - 1].children = child.node;
            i = child.next;
            continue;
        }
        if (match) {
            node.items.push({ text: match[3] });
        } else if (node.items.length) {
            // Continuation line of the previous item.
            node.items[node.items.length - 1].text += ` ${lines[i].trim()}`;
        }
        i++;
    }
    return { node, next: i };
}

function listToHtml(node: ListNode): string {
    const tag = node.ordered ? 'ol' : 'ul';
    return `<${tag}>${node.items
        .map(item => `<li>${renderInline(item.text)}${item.children ? listToHtml(item.children) : ''}</li>`)
        .join('')}</${tag}>`;
}

/** Inline formatting on escaped text. Code spans are protected from other rules. */
export function renderInline(text: string): string {
    const codeSpans: string[] = [];
    let result = escapeHtml(text).replace(/`([^`]+)`/g, (_, code: string) => {
        codeSpans.push(`<code>${code}</code>`);
        return `\u0000${codeSpans.length - 1}\u0000`;
    });

    result = result
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label: string, url: string) =>
            `<a href="${url}" title="${url}">${label}</a>`)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
        .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');

    // eslint-disable-next-line no-control-regex
    return result.replace(/\u0000(\d+)\u0000/g, (_, index: string) => codeSpans[Number(index)]);
}

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character] as string);
}
