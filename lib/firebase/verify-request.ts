import { NextRequest } from 'next/server';
import { adminAuth, useEmulators } from '@/lib/firebase/admin';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME } from '@/lib/firebase/server-session';

export interface AuthResult {
  uid: string | null;
  /** True when the request carried no usable bearer token at all. */
  missingToken: boolean;
  /**
   * True when a token was present but could not be checked because the server
   * has no credentials. Callers must not treat this as a successful verification.
   */
  verificationUnavailable: boolean;
}

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Verifies the caller's authentication.
 *
 * It checks the bearer token first. If missing or invalid, it checks the session cookie.
 */
export async function verifyRequest(req: NextRequest): Promise<AuthResult> {
  const token = bearerToken(req);
  let uid: string | null = null;
  let verificationUnavailable = false;

  if (token) {
    try {
      const decoded = await adminAuth.verifyIdToken(token);
      uid = decoded.uid;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('Could not load the default credentials') ||
        message.includes('client_email') ||
        message.includes('Unable to detect a Project Id') ||
        message.includes('credential')
      ) {
        console.error('Cannot verify ID tokens: server credentials are not configured.', message);
        verificationUnavailable = true;
      }
    }
  }

  if (!uid && !verificationUnavailable) {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    
    if (sessionCookie) {
      try {
        const decoded = useEmulators
          ? await adminAuth.verifyIdToken(sessionCookie, true)
          : await adminAuth.verifySessionCookie(sessionCookie, true);
        uid = decoded.uid;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes('Could not load the default credentials') ||
          message.includes('client_email') ||
          message.includes('Unable to detect a Project Id') ||
          message.includes('credential')
        ) {
          console.error('Cannot verify session cookies: server credentials are not configured.', message);
          verificationUnavailable = true;
        }
      }
    }
  }

  if (verificationUnavailable) {
    return { uid: null, missingToken: false, verificationUnavailable: true };
  }

  if (!uid) {
    return { uid: null, missingToken: true, verificationUnavailable: false };
  }

  return { uid, missingToken: false, verificationUnavailable: false };
}
