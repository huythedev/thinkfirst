import { cookies } from 'next/headers';
import { adminAuth } from '@/lib/firebase/admin';
import { adminDb } from '@/lib/firebase/admin';
import type { Role } from '@/lib/types/user';

/**
 * Server-side session verification.
 *
 * Role-protected routes are guarded here rather than in a client `useEffect`. A
 * client redirect only changes what is painted; the markup and any data the
 * component fetched have already been produced. These helpers run on the server
 * before rendering, so an unauthorized visitor never receives the page.
 *
 * The browser holds a Firebase ID token in memory, which server components
 * cannot read. `/api/auth/session` exchanges that token for an HttpOnly session
 * cookie, and this module verifies that cookie.
 */

export const SESSION_COOKIE_NAME = 'thinkfirst_session';

/** Firebase session cookies support a maximum lifetime of 14 days. */
export const SESSION_COOKIE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface ServerSession {
  uid: string;
  role: Role | null;
  displayName: string | null;
}

/**
 * Distinguishes "no valid session" from "the server cannot check". Callers must
 * fail closed on either, but the difference matters for diagnostics: an
 * unconfigured server should not look like a rejected user.
 */
export type SessionResult =
  | { status: 'valid'; session: ServerSession }
  | { status: 'unauthenticated' }
  | { status: 'verification_unavailable' };

function isCredentialProblem(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Could not load the default credentials') ||
    message.includes('Unable to detect a Project Id') ||
    message.includes('client_email') ||
    message.includes('credential')
  );
}

/**
 * Verifies the session cookie and loads the caller's role from Firestore.
 *
 * The role is read server-side and never accepted from the client, per section
 * 29. When the role cannot be read, it is reported as `null` and the caller
 * denies access rather than assuming a role.
 */
export async function getServerSession(): Promise<SessionResult> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) {
    return { status: 'unauthenticated' };
  }

  let uid: string;
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    uid = decoded.uid;
  } catch (error) {
    if (isCredentialProblem(error)) {
      console.error('Cannot verify session cookies: server credentials are not configured.');
      return { status: 'verification_unavailable' };
    }
    return { status: 'unauthenticated' };
  }

  try {
    const snapshot = await adminDb.collection('users').doc(uid).get();
    const data = snapshot.data();
    const role = (data?.role as Role | undefined) ?? null;
    return {
      status: 'valid',
      session: {
        uid,
        role,
        displayName: (data?.displayName as string | undefined) ?? null,
      },
    };
  } catch (error) {
    if (isCredentialProblem(error)) {
      return { status: 'verification_unavailable' };
    }
    // The identity is proven but the profile is unreadable. Treat the role as
    // unknown so role checks deny rather than guess.
    console.error('Session verified but user profile could not be read.', error);
    return { status: 'valid', session: { uid, role: null, displayName: null } };
  }
}
