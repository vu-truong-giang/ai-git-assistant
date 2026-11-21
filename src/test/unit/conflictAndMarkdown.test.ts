import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { applyConflictResolutions, parseConflictFile } from '../../ai/features/conflictParser';
import { renderMarkdown } from '../../ui/markdown';

const CONFLICT = [
    'import x from "x";',
    '<<<<<<< HEAD',
    'const port = 3000;',
    '=======',
    'const port = 8080;',
    '>>>>>>> feature/port',
    'start(port);',
    '<<<<<<< HEAD',
    'log("a");',
    '||||||| base',
    'log("base");',
    '=======',
    'log("b");',
    '>>>>>>> feature/port',
    ''
].join('\r\n');

describe('Merge conflict parsing (EPIC 13)', () => {
    it('finds hunks, labels, base sections and context', () => {
        const parsed = parseConflictFile(CONFLICT, 2);
        assert.equal(parsed.eol, '\r\n');
        assert.equal(parsed.hunks.length, 2);
        const [first, second] = parsed.hunks;
        assert.equal(first.oursLabel, 'HEAD');
        assert.equal(first.theirsLabel, 'feature/port');
        assert.equal(first.ours, 'const port = 3000;');
        assert.equal(first.theirs, 'const port = 8080;');
        assert.equal(first.base, undefined);
        assert.equal(first.contextBefore, 'import x from "x";');
        assert.equal(second.base, 'log("base");');
        assert.equal(second.contextBefore, 'start(port);');
    });

    it('applies resolutions and keeps CRLF line endings', () => {
        const parsed = parseConflictFile(CONFLICT);
        const result = applyConflictResolutions(parsed, new Map([
            [0, 'const port = process.env.PORT ?? 8080;'],
            [1, 'log("a");\nlog("b");\n']
        ]));
        assert.equal(result, [
            'import x from "x";',
            'const port = process.env.PORT ?? 8080;',
            'start(port);',
            'log("a");',
            'log("b");',
            ''
        ].join('\r\n'));
    });

    it('allows deleting a block and rejects bad resolutions', () => {
        const parsed = parseConflictFile('a\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> b\nz');
        assert.equal(applyConflictResolutions(parsed, new Map([[0, '']])), 'a\nz');
        assert.throws(() => applyConflictResolutions(parsed, new Map()), /Missing resolution/);
        assert.throws(() => applyConflictResolutions(parsed, new Map([[0, '<<<<<<< HEAD\nx']])), /conflict markers/);
    });

    it('rejects unclosed conflicts', () => {
        assert.throws(() => parseConflictFile('<<<<<<< HEAD\nx\n=======\ny\n'), /not closed/);
    });
});

describe('Safe Markdown rendering of AI output', () => {
    it('escapes HTML so AI output cannot inject markup', () => {
        const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)> **bold**');
        assert.ok(!html.includes('<script>'));
        assert.ok(!html.includes('<img'));
        assert.ok(html.includes('&lt;script&gt;'));
        assert.ok(html.includes('<strong>bold</strong>'));
    });

    it('only links http(s) URLs', () => {
        assert.ok(renderMarkdown('[ok](https://example.com)').includes('<a href="https://example.com"'));
        assert.ok(!renderMarkdown('[bad](javascript:alert(1))').includes('<a '));
    });

    it('renders headings, nested lists, code blocks and tables', () => {
        const html = renderMarkdown([
            '## Summary',
            '- item **one**',
            '  - nested `code`',
            '1. first',
            '',
            '```bash',
            'git reset --soft HEAD~1 <x>',
            '```',
            '| A | B |',
            '|---|---|',
            '| 1 | 2 |'
        ].join('\n'));
        assert.ok(html.includes('<h2>Summary</h2>'));
        assert.ok(html.includes('<ul><li>item <strong>one</strong><ul><li>nested <code>code</code></li></ul></li></ul>'));
        assert.ok(html.includes('<ol><li>first</li></ol>'));
        assert.ok(html.includes('<pre data-lang="bash"><code>git reset --soft HEAD~1 &lt;x&gt;</code></pre>'));
        assert.ok(html.includes('<th>A</th>') && html.includes('<td>2</td>'));
    });

    it('does not apply formatting inside inline code', () => {
        assert.ok(renderMarkdown('use `a*b*c` here').includes('<code>a*b*c</code>'));
    });
});
