import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Separate project for Firestore rules tests.
 *
 * These require the Firestore emulator on 127.0.0.1:8080, so they are excluded
 * from the default `vitest.config.mts` include list and run through
 * `npm run test:rules`, which starts the emulator around them.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    // Rules tests share one emulator database and clear it between tests, so
    // they must not run in parallel with each other.
    fileParallelism: false,
  },
});
