import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Separate project for tests that exercise real server code against the Firestore
 * emulator through the Admin SDK.
 *
 * These differ from `vitest.rules.config.mts`: the rules suite proves what a
 * *client* is refused, while this suite proves that the trusted server reads
 * resolve the documents they claim to. Both need the emulator, so neither runs in
 * the default offline command.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    // One shared emulator database, so these must not run in parallel.
    fileParallelism: false,
  },
});
