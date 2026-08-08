import { NextRequest } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin';

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
 * Verifies the caller's Firebase ID token.
 *
 * The Admin SDK needs Application Default Credentials or a service account. When
 * neither is present, verification cannot happen, and that is reported through
 * `verificationUnavailable` instead of being silently treated as a pass.
 */
export async function verifyRequest(req: NextRequest): Promise<AuthResult> {
  const token = bearerToken(req);
  if (!token) {
    return { uid: null, missingToken: true, verificationUnavailable: false };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return { uid: decoded.uid, missingToken: false, verificationUnavailable: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const credentialProblem =
      message.includes('Could not load the default credentials') ||
      message.includes('client_email') ||
      message.includes('Unable to detect a Project Id') ||
      message.includes('credential');

    if (credentialProblem) {
      console.error('Cannot verify ID tokens: server credentials are not configured.', message);
      return { uid: null, missingToken: false, verificationUnavailable: true };
    }

    return { uid: null, missingToken: false, verificationUnavailable: false };
  }
}
