import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { AIError } from '../../ai/models/AIError.model';
import { parseCommitMessage } from '../../ai/parsers/commitMessageParser';
import { extractJsonObject } from '../../ai/parsers/jsonResponse';
import { parseReview } from '../../ai/parsers/reviewParser';

describe('Commit message parsing (TASK 9.3)', () => {
    it('keeps a clean message as is', () => {
        assert.equal(parseCommitMessage('feat(auth): add login form'), 'feat(auth): add login form');
    });

    it('strips code fences, labels, quotes and trailing period', () => {
        assert.equal(parseCommitMessage('```\nfix: handle null user.\n```'), 'fix: handle null user');
        assert.equal(parseCommitMessage('Commit message: "docs: update README"'), 'docs: update README');
        assert.equal(parseCommitMessage('**Commit message:** chore: bump deps'), 'chore: bump deps');
    });

    it('normalises the body: one blank line after the subject, no triple newlines', () => {
        const parsed = parseCommitMessage('\n\nfeat: add chat\n- add panel\n\n\n\n- add history  \r\n');
        assert.equal(parsed, 'feat: add chat\n\n- add panel\n\n- add history');
    });

    it('rejects an empty answer', () => {
        assert.throws(() => parseCommitMessage('  ```\n```  '), (error: AIError) => error.code === 'INVALID_RESPONSE');
    });
});

describe('JSON extraction', () => {
    it('handles fences and surrounding text', () => {
        assert.deepEqual(extractJsonObject('Here you go:\n```json\n{"a": 1}\n```'), { a: 1 });
        assert.deepEqual(extractJsonObject('prefix {"b": [1,2]} suffix'), { b: [1, 2] });
    });

    it('fails clearly on non-JSON', () => {
        assert.throws(() => extractJsonObject('no json here'), (error: AIError) => error.code === 'INVALID_RESPONSE');
        assert.throws(() => extractJsonObject('{broken'), (error: AIError) => error.code === 'INVALID_RESPONSE');
    });
});

describe('Code review parsing (EPIC 11)', () => {
    it('normalises fields and sorts by severity', () => {
        const review = parseReview(JSON.stringify({
            summary: 'Mostly fine.',
            score: 7.6,
            issues: [
                { severity: 'minor', category: 'code smell', file: 'b/src/a.ts', line: 12, title: 'Long function', description: 'd', suggestion: 's' },
                { severity: 'CRITICAL', category: 'logic', file: 'src/b.ts', line: '40', title: 'Wrong condition' },
                { severity: 'weird', category: 'unknown', file: 'src/c.ts', line: -3 },
                'not an object'
            ],
            improvements: ['Add tests', '', 42]
        }));

        assert.equal(review.score, 8);
        assert.deepEqual(review.issues.map(issue => issue.severity), ['critical', 'minor', 'minor']);
        assert.equal(review.issues[0].line, 40);
        assert.equal(review.issues[1].category, 'code-smell');
        assert.equal(review.issues[1].file, 'src/a.ts');
        assert.equal(review.issues[2].category, 'maintainability');
        assert.equal(review.issues[2].line, null);
        assert.equal(review.issues[2].title, 'Issue');
        assert.deepEqual(review.improvements, ['Add tests', '42']);
    });

    it('accepts an empty review', () => {
        const review = parseReview('{"summary":"Clean","issues":[]}');
        assert.equal(review.issues.length, 0);
        assert.equal(review.score, null);
    });
});
