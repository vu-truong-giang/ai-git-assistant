const esbuild = require('esbuild');
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  outfile: 'dist/extension.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info'
};

async function build() {
  if (watch) {
    const context = await esbuild.context(options);
    await context.watch();
    console.log('Watching for changes...');
    return;
  }

  await esbuild.build(options);
}

build().catch(() => process.exit(1));
