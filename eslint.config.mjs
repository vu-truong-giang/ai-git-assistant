import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', 'out/**']
  },
  {
    files: ['src/ui/webview/**/*.js'],
    languageOptions: {
      globals: {
        acquireVsCodeApi: 'readonly',
        document: 'readonly',
        window: 'readonly'
      }
    }
  }
);
