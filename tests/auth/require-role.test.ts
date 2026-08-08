import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionResult } from '@/lib/firebase/server-session';

/**
 * Tests for the server-side role gate.
 *
 * The Phase 2 exit criterion says role-protected routes must reject unauthorized
 * users server-side, and that a client-side redirect does not satisfy it. The
 * gate existed without a test, which left the criterion unverified: nothing
 * proved that an unreadable role denies rather than defaults, or that a failure
 * to verify denies rather than passing through.
 *
 * `redirect` from next/navigation throws to unwind rendering, so it is mocked to
 * throw a recognisable error. A test that expected a return value would pass
 * even if the gate stopped redirecting.
 */

class RedirectError extends Error {
  constructor(public readonly target: string) {
    super(`NEXT_REDIRECT:${target}`);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (target: string) => {
    throw new RedirectError(target);
  },
}));

const getServerSession = vi.fn<() => Promise<SessionResult>>();

vi.mock('@/lib/firebase/server-session', () => ({
  getServerSession: () => getServerSession(),
}));

// Imported after the mocks are registered.
const { requireRole } = await import('@/lib/auth/require-role');

/** Returns the redirect target, or fails if the gate allowed the request. */
async function redirectTargetFor(role: 'student' | 'teacher'): Promise<string> {
  try {
    await requireRole(role);
  } catch (error) {
    if (error instanceof RedirectError) {
      return error.target;
    }
    throw error;
  }
  throw new Error('Expected the role gate to redirect, but it allowed the request through.');
}

beforeEach(() => {
  getServerSession.mockReset();
});

describe('requireRole denies before rendering', () => {
  it('redirects an unauthenticated visitor to sign-in', async () => {
    getServerSession.mockResolvedValue({ status: 'unauthenticated' });
    expect(await redirectTargetFor('student')).toBe('/sign-in');
  });

  it('fails closed when the server cannot verify the session', async () => {
    // A server without credentials must not be mistaken for a trusted caller.
    getServerSession.mockResolvedValue({ status: 'verification_unavailable' });
    expect(await redirectTargetFor('student')).toBe('/sign-in?error=verification_unavailable');
    expect(await redirectTargetFor('teacher')).toBe('/sign-in?error=verification_unavailable');
  });

  it('denies a student who requests the teacher area', async () => {
    getServerSession.mockResolvedValue({
      status: 'valid',
      session: { uid: 'student-a', role: 'student', displayName: 'Student A' },
    });
    expect(await redirectTargetFor('teacher')).toBe('/student');
  });

  it('denies a teacher who requests the student area', async () => {
    getServerSession.mockResolvedValue({
      status: 'valid',
      session: { uid: 'teacher-a', role: 'teacher', displayName: 'Teacher A' },
    });
    expect(await redirectTargetFor('student')).toBe('/teacher');
  });

  it('denies an admin, who holds neither the student nor the teacher role', async () => {
    getServerSession.mockResolvedValue({
      status: 'valid',
      session: { uid: 'admin-a', role: 'admin', displayName: 'Admin' },
    });
    expect(await redirectTargetFor('student')).toBe('/student');
  });

  it('sends an authenticated visitor with no role to onboarding', async () => {
    // Also covers the case where the profile read failed: the role is reported
    // as null and must not be treated as the requested role.
    getServerSession.mockResolvedValue({
      status: 'valid',
      session: { uid: 'new-user', role: null, displayName: null },
    });
    expect(await redirectTargetFor('student')).toBe('/onboarding');
    expect(await redirectTargetFor('teacher')).toBe('/onboarding');
  });
});

describe('requireRole admits the matching role', () => {
  it('returns the session for a student in the student area', async () => {
    getServerSession.mockResolvedValue({
      status: 'valid',
      session: { uid: 'student-a', role: 'student', displayName: 'Student A' },
    });
    await expect(requireRole('student')).resolves.toEqual({
      uid: 'student-a',
      role: 'student',
      displayName: 'Student A',
    });
  });

  it('returns the session for a teacher in the teacher area', async () => {
    getServerSession.mockResolvedValue({
      status: 'valid',
      session: { uid: 'teacher-a', role: 'teacher', displayName: 'Teacher A' },
    });
    await expect(requireRole('teacher')).resolves.toMatchObject({ role: 'teacher' });
  });
});
