import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { limitDiff, truncateLines } from '../../ai/context/ContextLimiter';
import { annotateDiffWithLineNumbers, parseDiffSections, unquoteGitPath } from '../../ai/context/diffUtils';
import { matchesGlob } from '../../ai/context/glob';
import { redactSecrets } from '../../ai/context/SecretRedactor';

function fileDiff(path: string, added: string[]): string {
    return `diff --git a/${path} b/${path}
index 1111111..2222222 100644
--- a/${path}
+++ b/${path}
@@ -1,1 +1,${added.length + 1} @@
 context
${added.map(line => `+${line}`).join('\n')}
`;
}

describe('Diff parsing — many diff types (TASK 8.2 / 10.5)', () => {
    const raw = [
        'diff --git a/src/new.ts b/src/new.ts\nnew file mode 100644\nindex 0000000..abc\n--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,2 @@\n+line1\n+line2\n',
        'diff --git a/old.txt b/old.txt\ndeleted file mode 100644\nindex abc..0000000\n--- a/old.txt\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-a\n-b\n-c\n',
        'diff --git a/a/name.ts b/b/name.ts\nsimilarity index 90%\nrename from a/name.ts\nrename to b/name.ts\nindex 1..2 100644\n--- a/a/name.ts\n+++ b/b/name.ts\n@@ -1 +1 @@\n-x\n+y\n',
        'diff --git a/logo.png b/logo.png\nindex 1..2 100644\nBinary files a/logo.png and b/logo.png differ\n',
        'diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n',
        'diff --git "a/t\\303\\251st file.md" "b/t\\303\\251st file.md"\nindex 1..2 100644\n--- "a/t\\303\\251st file.md"\n+++ "b/t\\303\\251st file.md"\n@@ -1 +1,2 @@\n x\n+--- not a header\n'
    ].join('');
    const sections = parseDiffSections(raw);

    it('splits one section per file', () => {
        assert.deepEqual(sections.map(section => section.path),
            ['src/new.ts', 'old.txt', 'b/name.ts', 'logo.png', 'run.sh', 'tést file.md']);
    });

    it('detects status, binary, mode change and line counts', () => {
        const [added, deleted, renamed, binary, mode, unicode] = sections;
        assert.equal(added.status, 'added');
        assert.deepEqual([added.additions, added.deletions], [2, 0]);
        assert.equal(deleted.status, 'deleted');
        assert.deepEqual([deleted.additions, deleted.deletions], [0, 3]);
        assert.equal(renamed.status, 'renamed');
        assert.equal(renamed.oldPath, 'a/name.ts');
        assert.equal(binary.binary, true);
        assert.equal(mode.modeChanged, true);
        // A "+--- ..." line inside a hunk is content, not a file header.
        assert.deepEqual([unicode.additions, unicode.deletions], [1, 0]);
    });

    it('handles CRLF output', () => {
        const crlf = fileDiff('win.txt', ['a', 'b']).replace(/\n/g, '\r\n');
        const [section] = parseDiffSections(crlf);
        assert.equal(section.path, 'win.txt');
        assert.equal(section.additions, 2);
    });

    it('returns nothing for an empty diff', () => {
        assert.deepEqual(parseDiffSections(''), []);
    });

    it('decodes quoted git paths', () => {
        assert.equal(unquoteGitPath('"a/caf\\303\\251.txt"'), 'a/café.txt');
        assert.equal(unquoteGitPath('plain.txt'), 'plain.txt');
    });

    it('annotates hunk lines with new-file line numbers (for code review)', () => {
        const annotated = annotateDiffWithLineNumbers(
            'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -10,3 +10,3 @@\n keep\n-old\n+new\n keep2\n');
        // Marker column + 5-wide right-aligned number.
        assert.match(annotated, /^ {4}10 \| keep$/m);
        assert.match(annotated, /^- {6}\| old$/m);
        assert.match(annotated, /^\+ {3}11 \| new$/m);
        assert.match(annotated, /^ {4}12 \| keep2$/m);
    });
});

describe('Context size limit (TASK 8.6)', () => {
    it('keeps small diffs unchanged', () => {
        const raw = fileDiff('a.ts', ['one', 'two']);
        const limited = limitDiff(raw, { maxChars: 10_000, excludePatterns: [] });
        assert.equal(limited.text, raw);
        assert.deepEqual(limited.truncatedFiles, []);
    });

    it('shares the budget fairly: small files stay whole, the huge file is cut', () => {
        const small1 = fileDiff('small1.ts', ['a']);
        const small2 = fileDiff('small2.ts', ['b']);
        const huge = fileDiff('huge.ts', Array.from({ length: 2000 }, (_, i) => `line ${i} ${'x'.repeat(40)}`));
        const limited = limitDiff(small1 + huge + small2, { maxChars: 5000, excludePatterns: [] });

        assert.ok(limited.text.includes(small1));
        assert.ok(limited.text.includes(small2));
        assert.deepEqual(limited.truncatedFiles, ['huge.ts']);
        assert.ok(limited.text.length <= 5000 + 200, `length ${limited.text.length}`);
        assert.match(limited.text, /\[truncated: \d+ more line\(s\) not shown\]/);
        // Order of files is preserved.
        assert.ok(limited.text.indexOf('small1.ts') < limited.text.indexOf('huge.ts'));
        assert.ok(limited.text.indexOf('huge.ts') < limited.text.indexOf('small2.ts'));
    });

    it('replaces lock files, binaries and sensitive files with one-line notes', () => {
        const raw = fileDiff('package-lock.json', ['"x": 1'])
            + fileDiff('.env', ['DB_PASSWORD=hunter2hunter2'])
            + fileDiff('config/server.pem', ['-----BEGIN PRIVATE KEY-----'])
            + 'diff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ\n'
            + fileDiff('src/app.ts', ['ok']);
        const limited = limitDiff(raw, { maxChars: 10_000, excludePatterns: ['package-lock.json'] });

        assert.deepEqual(limited.omitted.map(item => `${item.path}:${item.reason}`), [
            'package-lock.json:excluded', '.env:sensitive', 'config/server.pem:sensitive', 'img.png:binary'
        ]);
        assert.ok(!limited.text.includes('hunter2'));
        assert.ok(!limited.text.includes('BEGIN PRIVATE KEY'));
        assert.ok(limited.text.includes('+ok'));
        assert.equal(limited.files.length, 5);
    });

    it('truncates at line boundaries', () => {
        const text = 'aaaa\nbbbb\ncccc\ndddd\n';
        const cut = truncateLines(text, 10);
        assert.ok(cut.startsWith('aaaa\nbbbb\n'));
        assert.match(cut, /truncated: 3 more line/);
    });
});

describe('Secret redaction (EPIC 13 security)', () => {
    it('masks well-known token formats', () => {
        const samples = [
            'AIzaSyA1234567890abcdefghijklmnopqrstuv',
            'sk-proj-abcdefghijklmnopqrstuvwxyz123456',
            'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
            'AKIAABCDEFGHIJKLMNOP',
            'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
        ];
        for (const sample of samples) {
            const result = redactSecrets(`const token = foo("${sample}");`);
            assert.ok(!result.text.includes(sample), sample);
            assert.ok(result.count >= 1, sample);
        }
    });

    it('masks password-like assignments but keeps the key name', () => {
        const result = redactSecrets('+  password: "SuperSecret123"\n+  apiKey = abcdef123456\n+ DB_PASSWORD=hunter2hunter2');
        assert.ok(!result.text.includes('SuperSecret123'));
        assert.ok(!result.text.includes('abcdef123456'));
        assert.ok(!result.text.includes('hunter2hunter2'));
        assert.ok(result.text.includes('password: "[REDACTED]"'));
        assert.equal(result.count, 3);
    });

    it('masks private key blocks and URL credentials', () => {
        const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----';
        assert.equal(redactSecrets(key).text, '[REDACTED]');
        assert.equal(redactSecrets('postgres://admin:pa55word@db.local/app').text, 'postgres://[REDACTED]@db.local/app');
    });

    it('leaves normal code and env references alone', () => {
        const code = 'const password = process.env.DB_PASSWORD;\nconst passwordLength = 12;\nif (token) { login(); }';
        const result = redactSecrets(code);
        assert.equal(result.text, code);
        assert.equal(result.count, 0);
    });
});

describe('Glob matching', () => {
    it('matches basenames, folders and **', () => {
        assert.ok(matchesGlob('a/b/package-lock.json', 'package-lock.json'));
        assert.ok(matchesGlob('web/app.min.js', '*.min.js'));
        assert.ok(matchesGlob('dist/x/y.js', 'dist/**'));
        assert.ok(matchesGlob('src/deep/file.ts', 'src/**/*.ts'));
        assert.ok(matchesGlob('.env.local', '.env.*'));
        assert.ok(!matchesGlob('src/dist.ts', 'dist/**'));
        assert.ok(!matchesGlob('environment.ts', '.env'));
    });
});
