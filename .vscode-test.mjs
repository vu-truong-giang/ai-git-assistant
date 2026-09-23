import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: `${process.cwd()}/out/test/**/*.test.js`,
  version: 'stable',
  workspaceFolder: process.cwd()
});
