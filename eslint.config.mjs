import eslint from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/.next/**',
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...nextVitals.map((config) => ({
    ...config,
    files: ['apps/web/**/*.{js,jsx,ts,tsx}'],
  })),
  {
    files: ['apps/web/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  {
    files: [
      '*.{js,mjs,cjs,ts}',
      '**/*.{config,server}.{js,mjs,cjs,ts,tsx}',
      '**/{middleware,route}.{js,ts}',
      '**/*.{test,spec}.{js,jsx,ts,tsx}',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  prettier,
);
