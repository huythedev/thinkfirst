import { initializeApp, getApps, App, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import firebaseConfig from '../../firebase-applet-config.json';

/**
 * Firebase Admin SDK initialization.
 *
 * Server-side session verification runs through this app, so every
 * role-protected route depends on it. When the client SDK is pointed at the
 * emulators, the Admin SDK must follow: the emulator mints session cookies that
 * production Google endpoints will not recognise, so a split configuration
 * makes `verifySessionCookie` fail and silently redirects every signed-in
 * visitor back to sign-in.
 *
 * The Admin SDK discovers the emulators through `FIREBASE_AUTH_EMULATOR_HOST`
 * and `FIRESTORE_EMULATOR_HOST`, which it reads from the process environment.
 * Those are derived here from the same `NEXT_PUBLIC_*` variables the client
 * uses, so there is one switch rather than two that can disagree.
 */

const useEmulators =
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true' ||
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === '1';

if (useEmulators) {
  const authHost = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreHost = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST;

  if (!authHost || !firestoreHost) {
    throw new Error(
      'NEXT_PUBLIC_USE_FIREBASE_EMULATORS is set, but NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ' +
        'and NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST are required so the Admin SDK targets the ' +
        'same emulators as the client. See .env.example.',
    );
  }

  // Set before initializeApp: the SDK reads these when it builds its clients,
  // and skips credential discovery and token signature verification for them.
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= authHost;
  process.env.FIRESTORE_EMULATOR_HOST ??= firestoreHost;
}

let adminApp: App;

if (!getApps().length) {
  const projectId = firebaseConfig.projectId;
  const initConfig: any = {
    projectId,
    storageBucket: firebaseConfig.storageBucket,
  };

  // If a JSON string is provided via environment variable, parse and use it.
  // This avoids needing a physical file for GOOGLE_APPLICATION_CREDENTIALS.
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      initConfig.credential = cert(serviceAccount);
    } catch (error) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY JSON:', error);
    }
  }

  adminApp = initializeApp(initConfig);
} else {
  adminApp = getApps()[0];
}

const adminDb = getFirestore(adminApp, (firebaseConfig as any).firestoreDatabaseId);
const adminAuth = getAuth(adminApp);
const adminStorage = getStorage(adminApp);

export { adminDb, adminAuth, adminStorage, adminApp as admin, useEmulators };

