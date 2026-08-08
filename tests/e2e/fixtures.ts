import type { APIRequestContext, BrowserContext } from '@playwright/test';
import firebaseConfig from '../../firebase-applet-config.json';

/**
 * Shared fixtures for the section 38 end-to-end scenarios.
 *
 * Sign-in uses a Google popup, which cannot be automated. Every helper here
 * therefore mints a session cookie through the **real** `/api/auth/session`
 * route from a real emulator ID token, which is the same cookie a human sign-in
 * produces and passes the same server-side gate. Nothing here bypasses
 * authorization; it bypasses only the popup.
 */

const AUTH_HOST = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FIRESTORE_HOST = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085';
const PROJECT_ID = 'thinkfirst-huythedeev';
const API_KEY = (firebaseConfig as { apiKey: string }).apiKey;
const DATABASE_ID = 'ai-studio-thinkfirst-1bd3a5e3-9884-49d7-91b8-e5b1e8a4f1fa';
const DOCS = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

export const str = (stringValue: string) => ({ stringValue });
export const int = (value: number) => ({ integerValue: String(value) });
export const dbl = (doubleValue: number) => ({ doubleValue });
export const bool = (booleanValue: boolean) => ({ booleanValue });
export const time = (date: Date) => ({ timestampValue: date.toISOString() });
export const arr = (values: unknown[]) => ({ arrayValue: { values } });

export interface Account {
  uid: string;
  idToken: string;
  email: string;
}

export async function createAccount(prefix: string): Promise<Account> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.invalid`;
  const response = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'e2e-password', returnSecureToken: true }),
    },
  );
  const body = await response.json();
  if (!body.idToken) throw new Error(`signUp failed: ${JSON.stringify(body)}`);
  return { uid: body.localId, idToken: body.idToken, email };
}

export async function writeDoc(
  path: string,
  fields: Record<string, unknown>,
  documentId?: string,
): Promise<void> {
  const url = documentId
    ? `${DOCS}/${path}?documentId=${encodeURIComponent(documentId)}`
    : `${DOCS}/${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (response.ok) return;

  // Scenario D writes the same document twice on purpose: once as an
  // unconfirmed low-confidence extraction, then again as the student's
  // confirmation. The REST create endpoint refuses the second write, so an
  // existing document is patched instead.
  if (response.status === 409 && documentId) {
    const patch = await fetch(`${DOCS}/${path}/${encodeURIComponent(documentId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ fields }),
    });
    if (!patch.ok) throw new Error(`${path}/${documentId}: ${await patch.text()}`);
    return;
  }
  throw new Error(`${path}: ${await response.text()}`);
}

export async function readDoc(path: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${DOCS}/${path}`, {
    headers: { Authorization: 'Bearer owner' },
  });
  if (!response.ok) return null;
  const body = await response.json();
  return body.fields ?? null;
}

export async function queryCollection(path: string): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${DOCS}/${path}`, {
    headers: { Authorization: 'Bearer owner' },
  });
  if (!response.ok) return [];
  const body = await response.json();
  return (body.documents ?? []).map(
    (document: { fields?: Record<string, unknown> }) => document.fields ?? {},
  );
}

/** Exchanges an ID token for the real session cookie and installs it. */
export async function signIn(
  context: BrowserContext,
  baseUrl: string,
  account: Account,
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: account.idToken }),
  });
  if (!response.ok) {
    throw new Error(`session exchange failed: ${response.status} ${await response.text()}`);
  }
  const setCookie = response.headers.get('set-cookie') ?? '';
  const match = /thinkfirst_session=([^;]+)/.exec(setCookie);
  if (!match) throw new Error(`no session cookie in response: ${setCookie}`);

  const url = new URL(baseUrl);
  await context.addCookies([
    {
      name: 'thinkfirst_session',
      value: match[1],
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  // The server cookie authorizes the *server*. Client components additionally
  // read the browser SDK's auth state, and a page that finds none renders
  // "your sign-in has expired" -- which is correct behavior, not a bug, and it
  // is why simply setting the cookie leaves the workspace unusable.
  //
  // So the SDK's own persistence record is seeded before any page script runs.
  // The key format is the one firebase/auth uses for localStorage persistence.
  await context.addInitScript(
    ({ apiKey, user }) => {
      try {
        window.localStorage.setItem(`firebase:authUser:${apiKey}:[DEFAULT]`, JSON.stringify(user));
      } catch {
        // A page served before storage is available simply renders signed out.
      }
    },
    {
      apiKey: API_KEY,
      user: authUserRecord(account),
    },
  );
}

/**
 * The shape `firebase/auth` persists for a signed-in user.
 *
 * Written out rather than obtained from the SDK because the SDK cannot run
 * outside a page, and the popup sign-in it normally uses cannot be automated.
 * Only the fields the application reads are populated.
 */
function authUserRecord(account: Account) {
  const [, payload] = account.idToken.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as {
    exp: number;
    iat: number;
  };
  return {
    uid: account.uid,
    email: account.email,
    emailVerified: false,
    isAnonymous: false,
    providerData: [],
    stsTokenManager: {
      refreshToken: 'e2e-refresh-token',
      accessToken: account.idToken,
      expirationTime: decoded.exp * 1000,
    },
    createdAt: String(decoded.iat * 1000),
    lastLoginAt: String(decoded.iat * 1000),
    apiKey: API_KEY,
    appName: '[DEFAULT]',
  };
}

export async function createStudent(
  context: BrowserContext,
  baseUrl: string,
  options: { grade?: number; displayName?: string } = {},
): Promise<Account> {
  const account = await createAccount('e2e-student');
  await writeDoc(
    'users',
    {
      id: str(account.uid),
      role: str('student'),
      displayName: str(options.displayName ?? 'E2E Student'),
      preferredLanguage: str('en'),
      createdAt: time(new Date()),
    },
    account.uid,
  );
  await writeDoc(
    'studentProfiles',
    {
      id: str(account.uid),
      grade: int(options.grade ?? 9),
      preferredLanguage: str('en'),
      createdAt: time(new Date()),
    },
    account.uid,
  );
  await signIn(context, baseUrl, account);
  return account;
}

export async function createTeacher(
  context: BrowserContext,
  baseUrl: string,
): Promise<Account> {
  const account = await createAccount('e2e-teacher');
  await writeDoc(
    'users',
    {
      id: str(account.uid),
      role: str('teacher'),
      displayName: str('E2E Teacher'),
      preferredLanguage: str('en'),
      createdAt: time(new Date()),
    },
    account.uid,
  );
  await signIn(context, baseUrl, account);
  return account;
}

export interface SessionOptions {
  mode?: 'learn' | 'practice' | 'assignment' | 'verify';
  strictness?: 'supportive' | 'balanced' | 'independence' | 'assessment_safe';
  problem?: string;
  currentHintLevel?: number;
  /** Matches the field `resolvePolicyInputs` reads: `imageId`, not `problemImageId`. */
  imageId?: string;
}

export async function createSession(
  studentUid: string,
  options: SessionOptions = {},
): Promise<string> {
  const sessionId = `e2e-session-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const fields: Record<string, unknown> = {
    id: str(sessionId),
    studentId: str(studentUid),
    subject: str('mathematics'),
    grade: int(9),
    language: str('en'),
    mode: str(options.mode ?? 'practice'),
    strictness: str(options.strictness ?? 'balanced'),
    status: str('active'),
    originalProblem: str(options.problem ?? 'Solve x^2 - 5x + 6 = 0.'),
    currentHintLevel: int(options.currentHintLevel ?? 0),
    startedAt: time(new Date()),
    policyVersion: str('policy-v2'),
    scoringVersion: str('scoring-v2'),
  };
  if (options.imageId) fields.imageId = str(options.imageId);
  await writeDoc('learningSessions', fields, sessionId);
  return sessionId;
}

/**
 * Sends a tutoring turn through the real endpoint with a real ID token.
 *
 * Called directly rather than through the page's Firebase instance: the
 * endpoint authenticates with a bearer token, so this exercises the same
 * authorization path the browser does without depending on the client SDK's
 * internal state being ready at the moment the test runs.
 */
export async function sendTurn(
  request: APIRequestContext,
  account: Account,
  sessionId: string,
  message: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await request.post('/api/session/chat', {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${account.idToken}`,
    },
    data: { sessionId, message },
    failOnStatusCode: false,
  });
  let body: Record<string, unknown> = {};
  try {
    body = await response.json();
  } catch {
    body = { raw: await response.text() };
  }
  return { status: response.status(), body };
}
