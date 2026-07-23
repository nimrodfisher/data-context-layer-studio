import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'automatic',
    },
  },
  test: {
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
    exclude: ['**/e2e/**', '**/node_modules/**'],
    include: ['{apps,packages}/**/*.{test,spec}.{ts,tsx}'],
  },
});
