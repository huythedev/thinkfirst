import type { FirebaseApp } from 'firebase/app';

/**
 * Firebase App Check activation (section 25, section 41, Phase 8).
 *
 * ## Why this file exists at all
 *
 * The Phase 8 exit criterion permits either outcome: "App Check is configured, or
 * its absence is recorded in `ASSUMPTIONS.md` with the exact manual steps and the
 * acceptance criteria it blocks." This environment cannot satisfy the first half.
 * App Check needs a real Firebase project and a reCAPTCHA Enterprise site-key
 * registration, and there is neither: `firebase-applet-config.json` carries an
 * empty `recaptchaSiteKey`, and no project is deployed.
 *
 * Recording the absence is therefore the honest branch, and it is recorded in
 * `docs/ASSUMPTIONS.md` (S7) with the manual steps and in `docs/THREAT-MODEL.md`
 * against the threats it leaves open.
 *
 * But documentation alone would guarantee the gap stays open: the next person to
 * register a site key would also have to discover that no activation code exists,
 * find the right SDK entry point, and place the call before any Firebase service
 * is used. So the wiring ships now, inert, and activates the moment a key is
 * present. Configuring App Check becomes a deployment step rather than a
 * development task.
 *
 * ## Why the import is dynamic
 *
 * `firebase/app-check` pulls in the reCAPTCHA provider and attempts network work
 * on activation. A static import would add it to the bundle of every page for a
 * feature that is off, and would run provider setup during module evaluation in
 * environments that cannot reach the network, including the test suite.
 */

export type AppCheckStatus =
  | 'active'
  | 'not_configured'
  | 'skipped_server'
  | 'skipped_emulator'
  | 'failed';

export interface AppCheckResult {
  status: AppCheckStatus;
  detail: string;
}

/** Reads the site key from the client config, treating blank as absent. */
export function readSiteKey(config: { recaptchaSiteKey?: string }): string | null {
  const key = config.recaptchaSiteKey?.trim();
  return key && key.length > 0 ? key : null;
}

export interface ActivateOptions {
  app: FirebaseApp;
  siteKey: string | null;
  /** True when the client is pointed at emulators. */
  usingEmulators: boolean;
  /** False during server rendering. */
  isBrowser: boolean;
}

/**
 * Activates App Check when, and only when, it can work.
 *
 * Every early return is a real condition rather than defensive padding:
 *
 * - Server rendering has no `document`, and the reCAPTCHA provider requires one.
 * - The emulator suite does not verify App Check tokens, so activating against it
 *   only produces console noise and failed attestation attempts.
 * - No site key means the feature is not provisioned. Reported as
 *   `not_configured` rather than thrown, because a missing abuse control must not
 *   stop a student signing in; authorization is enforced independently by ID-token
 *   verification and security rules, which do fail closed.
 */
export async function activateAppCheck(options: ActivateOptions): Promise<AppCheckResult> {
  if (!options.isBrowser) {
    return { status: 'skipped_server', detail: 'App Check runs in the browser only.' };
  }

  if (options.usingEmulators) {
    return {
      status: 'skipped_emulator',
      detail: 'App Check is not enforced against the local emulator suite.',
    };
  }

  if (!options.siteKey) {
    return {
      status: 'not_configured',
      detail:
        'recaptchaSiteKey is empty. See docs/ASSUMPTIONS.md S7 for the registration steps.',
    };
  }

  try {
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import(
      'firebase/app-check'
    );

    initializeAppCheck(options.app, {
      provider: new ReCaptchaEnterpriseProvider(options.siteKey),
      // Lets a returning client attest without a fresh challenge on every call.
      isTokenAutoRefreshEnabled: true,
    });

    return { status: 'active', detail: 'App Check activated with reCAPTCHA Enterprise.' };
  } catch (error) {
    // Never fatal. An abuse control that fails must not become an outage, and the
    // controls that actually gate access are elsewhere and fail closed.
    return {
      status: 'failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
