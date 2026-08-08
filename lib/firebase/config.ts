import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import { validateEnv } from '../env';
import { activateAppCheck, readSiteKey } from './app-check';

const { firestoreDatabaseId, ...clientConfig } = firebaseConfig;

const isFirstInit = !getApps().length;
const app = isFirstInit ? initializeApp(clientConfig) : getApp();
const auth = getAuth(app);
const db = firestoreDatabaseId ? getFirestore(app, firestoreDatabaseId) : getFirestore(app);
const storage = getStorage(app);

// Next.js inlines NEXT_PUBLIC_* at build time, so these must be referenced as
// full literals rather than looked up dynamically on process.env.
const { env, failures } = validateEnv({
	NEXT_PUBLIC_USE_FIREBASE_EMULATORS: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS,
	NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
	NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST,
	NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST,
});

if (failures.length > 0) {
	throw new Error(
		`Firebase client configuration is invalid:\n${failures
			.map((failure) => `  - ${failure.variable}: ${failure.problem}`)
			.join('\n')}`,
	);
}

function splitHost(value: string): { host: string; port: number } {
	const separator = value.lastIndexOf(':');
	return {
		host: value.slice(0, separator),
		port: Number(value.slice(separator + 1)),
	};
}

if (isFirstInit && env?.NEXT_PUBLIC_USE_FIREBASE_EMULATORS) {
	const authHost = splitHost(env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST!);
	const firestoreHost = splitHost(env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST!);

	connectAuthEmulator(auth, `http://${authHost.host}:${authHost.port}`, { disableWarnings: true });
	connectFirestoreEmulator(db, firestoreHost.host, firestoreHost.port);

	const storageHostValue = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST;
	if (storageHostValue) {
		const storageHost = splitHost(storageHostValue);
		connectStorageEmulator(storage, storageHost.host, storageHost.port);
	}

	if (process.env.NODE_ENV !== 'production') {
		console.info(
			`[firebase] Using emulators: auth ${env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST}, firestore ${env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST}`,
		);
	}
}

// App Check (section 25, section 41). Inert until a reCAPTCHA site key is
// registered; see lib/firebase/app-check.ts and docs/ASSUMPTIONS.md S7. Placed
// after the emulator branch so a local run reports `skipped_emulator` rather than
// attempting attestation against a suite that does not verify it.
if (isFirstInit) {
	void activateAppCheck({
		app,
		siteKey: readSiteKey(firebaseConfig),
		usingEmulators: Boolean(env?.NEXT_PUBLIC_USE_FIREBASE_EMULATORS),
		isBrowser: typeof window !== 'undefined',
	}).then((result) => {
		// Logged in development only, and never at error level: `not_configured` is
		// the expected state in this repository, and a red console entry for a
		// documented gap trains people to ignore the console.
		if (process.env.NODE_ENV !== 'production' && result.status !== 'skipped_server') {
			console.info(`[firebase] App Check: ${result.status} — ${result.detail}`);
		}
	});
}

export { app, auth, db, storage };
