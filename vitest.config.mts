import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Rules and integration tests need the Firestore emulator, so they are not
    // part of the default offline run. `npm run test:rules` and
    // `npm run test:integration` start the emulator around them.
    // `tests/e2e` is Playwright, which has its own runner and its own
    // `expect`; vitest would try to execute those specs and fail on the import.
    exclude: ['tests/rules/**', 'tests/integration/**', 'tests/e2e/**'],
  },
});
