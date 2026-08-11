import { defineConfig, devices } from '@playwright/test';
import { loadEnvConfig } from '@next/env';

// Playwright evaluates this file before it starts Next. Load the same local
// environment file that `next dev` will use so the explicit live-test guard
// can confirm a server-side Gemini key is available. This key is never passed
// to the browser.
loadEnvConfig(process.cwd(), true);

// Live-provider runs are intentionally opt-in: the normal E2E suite must stay
// deterministic and must not spend API quota in local runs or CI.
const useLiveGemini = process.env.E2E_LIVE_GEMINI === '1';

if (useLiveGemini && !process.env.GEMINI_API_KEY?.trim()) {
  throw new Error(
    'E2E_LIVE_GEMINI=1 requires GEMINI_API_KEY. Put it in .env.local; never commit that file.',
  );
}

/**
 * Playwright configuration for the section 38 end-to-end scenarios.
 *
 * Two decisions worth stating, because both bound what these specs can claim.
 *
 * **The specs drive the real application, not a mock of it.** They run against
 * `next dev` with the Firebase emulators, so the server-side role gate, the
 * security rules and the policy engine are all live.
 *
 * **The model is not by default.** `AI_MODEL_DRIVER=mock` is set for the web server, so the
 * tutoring turns resolve deterministically through `lib/ai/model-client.ts`. The
 * free Gemini tier allows twenty requests a day and a tutoring turn makes up to
 * four calls, so a six-scenario suite could not otherwise be run even once. What
 * the specs therefore verify is the application's behavior -- routing,
 * authorization, persistence, policy enforcement and the rendered UI -- given a
 * known model response, which is exactly the part that regressions live in.
 * Set `E2E_LIVE_GEMINI=1` (or use `npm run test:e2e:gemini`) for an explicit,
 * quota-spending Gemini smoke run.
 *
 * Sign-in itself uses a Google popup that cannot be automated. The specs mint a
 * session cookie through the real `/api/auth/session` route instead, which is
 * the same cookie a human sign-in produces and the same gate it passes.
 */

const PORT = Number(process.env.E2E_PORT ?? 3400);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  // These share one emulator database, so they must not race each other.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Section 40 and the Phase 9 responsive criterion: the same journeys are
    // checked at a phone viewport rather than assumed to work from the presence
    // of Tailwind utility classes.
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: {
    command: `env -u PORT next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true',
      // Required whenever the emulator flag is set: `lib/firebase/config.ts`
      // fails fast rather than silently talking to production, which is the
      // behavior Phase 1 added deliberately.
      NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST:
        process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099',
      NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST:
        process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085',
      NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST:
        process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199',
      // `live` is intentionally any non-mock value: see resolveModelDriver.
      AI_MODEL_DRIVER: useLiveGemini ? 'live' : 'mock',
    },
  },
});
