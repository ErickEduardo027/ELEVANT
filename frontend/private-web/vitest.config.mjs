import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  server: { fs: { allow: [projectRoot, fileURLToPath(new URL('../../packages/api-client/', import.meta.url))] } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setupTests.js'],
    // The visual suite runs in Chrome through Playwright (npm run test:visual), never in vitest.
    exclude: [...configDefaults.exclude, 'tests/visual/**'],
  },
});
