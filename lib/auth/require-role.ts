import { redirect } from 'next/navigation';
import { getServerSession, type ServerSession } from '@/lib/firebase/server-session';
import type { Role } from '@/lib/types/user';

/**
 * Server-side role gate for protected route groups.
 *
 * Call this at the top of a protected layout. It runs before the layout renders,
 * so a visitor without the required role is redirected instead of receiving the
 * page. Every outcome other than "valid session with the required role" denies.
 */
export async function requireRole(role: Role): Promise<ServerSession> {
  const result = await getServerSession();

  if (result.status === 'verification_unavailable') {
    // Failing closed: the server cannot establish who is calling.
    redirect('/sign-in?error=verification_unavailable');
  }

  if (result.status === 'unauthenticated') {
    redirect('/sign-in');
  }

  if (result.session.role === null) {
    // Authenticated but not yet onboarded, so no role exists to check.
    redirect('/onboarding');
  }

  if (result.session.role !== role) {
    // Signed in as the wrong role. Send them to their own area rather than
    // looping them through sign-in.
    redirect(result.session.role === 'teacher' ? '/teacher' : '/student');
  }

  return result.session;
}
