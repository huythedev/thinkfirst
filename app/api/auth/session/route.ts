import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, useEmulators } from '@/lib/firebase/admin';
import { SESSION_COOKIE_NAME, SESSION_COOKIE_MAX_AGE_MS } from '@/lib/firebase/server-session';

/**
 * Exchanges a Firebase ID token for an HttpOnly session cookie.
 *
 * Server components cannot read the in-memory ID token the client SDK holds, so
 * without this exchange there is nothing for a server-side route guard to check.
 * The cookie is HttpOnly, so script running in the page cannot read it.
 *
 * When the emulator is running, createSessionCookie is unavailable (the emulator
 * auth only supports createCustomToken).  In that case we mint a local bypass token
 * that the route guard verifies identically.
 */
export async function POST(req: NextRequest) {
  let idToken: string | undefined;
  try {
    const body = await req.json();
    idToken = typeof body?.idToken === 'string' ? body.idToken : undefined;
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  if (!idToken) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    // Verifying first means a forged token never reaches cookie creation.
    await adminAuth.verifyIdToken(idToken);

    let cookieValue: string;

    if (useEmulators) {
      // Emulator auth does not support createSessionCookie.  Mint a bypass token
      // that requireRole still verifies via verifySessionCookie.
      cookieValue = await adminAuth.createCustomToken(idToken);
    } else {
      cookieValue = await adminAuth.createSessionCookie(idToken, {
        expiresIn: SESSION_COOKIE_MAX_AGE_MS,
      });
    }

    const response = NextResponse.json({ status: 'ok' });
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: cookieValue,
      maxAge: SESSION_COOKIE_MAX_AGE_MS / 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    return response;
  } catch (error) {
    // No raw error text is returned to the caller, per section 41.
    console.error('Session cookie creation failed.', error);
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
}

/** Clears the session cookie on sign-out. */
export async function DELETE() {
  const response = NextResponse.json({ status: 'ok' });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    maxAge: 0,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  return response;
}
