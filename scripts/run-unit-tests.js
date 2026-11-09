// Bundles src/test/unit/*.test.ts with esbuild and runs them with Node's built-in test runner.
// The tested modules must not import 'vscode' (they are plain Node code).
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const testDir = path.join(root, 'src', 'test', 'unit');
const outDir = path.join(root, 'out', 'test');

const entryPoints = fs.readdirSync(testDir)
    .filter(file => file.endsWith('.test.ts'))
    .map(file => path.join(testDir, file));

fs.rmSync(outDir, { recursive: true, force: true });
esbuild.buildSync({
    entryPoints,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    outdir: outDir,
    external: ['vscode'],
    sourcemap: 'inline',
    logLevel: 'warning'
});

const files = fs.readdirSync(outDir)
    .filter(file => file.endsWith('.test.js'))
    .map(file => path.join(outDir, file));

const result = spawnSync(process.execPath, ['--enable-source-maps', '--test', ...files], {
    stdio: 'inherit',
    cwd: root
});
process.exit(result.status ?? 1);
