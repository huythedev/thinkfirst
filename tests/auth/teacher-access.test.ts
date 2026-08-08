import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit coverage for the teacher authorization gate.
 *
 * Every Phase 6 endpoint passes through `requireClassroomOwner`, so the negative
 * cases are tested once here rather than five times over HTTP. What matters is
 * that ownership is decided by stored data, and that the failure modes stay
 * distinct: a server with no credentials must not look like a rejected user, and
 * a classroom belonging to someone else must not look different from one that
 * does not exist.
 */

const verifyRequest = vi.fn();
const getDoc = vi.fn();

vi.mock('@/lib/firebase/verify-request', () => ({
  verifyRequest: (...args: unknown[]) => verifyRequest(...args),
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: () => getDoc(name, id),
      }),
    }),
  },
  adminAuth: {},
}));

const { requireClassroomOwner, requireTeacher, isActiveMember, teacherAuthResponseInit } =
  await import('@/lib/auth/teacher-access');

type Doc = { exists: boolean; id: string; data: () => Record<string, unknown> | undefined };

function docOf(id: string, data: Record<string, unknown> | null): Doc {
  return { exists: data !== null, id, data: () => data ?? undefined };
}

const request = {} as never;

beforeEach(() => {
  verifyRequest.mockReset();
  getDoc.mockReset();
});

describe('requireTeacher', () => {
  it('reports a missing server credential as unavailable, not as a rejected user', async () => {
    verifyRequest.mockResolvedValue({ uid: null, missingToken: false, verificationUnavailable: true });

    const result = await requireTeacher(request);

    expect(result).toEqual({ ok: false, reason: 'verification_unavailable' });
    expect(teacherAuthResponseInit('verification_unavailable').status).toBe(503);
  });

  it('refuses an unauthenticated caller', async () => {
    verifyRequest.mockResolvedValue({ uid: null, missingToken: true, verificationUnavailable: false });

    const result = await requireTeacher(request);

    expect(result).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(teacherAuthResponseInit('unauthenticated').status).toBe(401);
  });

  it('refuses a student holding a perfectly valid token', async () => {
    verifyRequest.mockResolvedValue({ uid: 'student-1', missingToken: false, verificationUnavailable: false });
    getDoc.mockResolvedValue(docOf('student-1', { role: 'student' }));

    const result = await requireTeacher(request);

    expect(result).toEqual({ ok: false, reason: 'not_a_teacher' });
    expect(teacherAuthResponseInit('not_a_teacher').status).toBe(403);
  });

  it('reads the role from Firestore rather than from the token claims', async () => {
    verifyRequest.mockResolvedValue({ uid: 'teacher-1', missingToken: false, verificationUnavailable: false });
    getDoc.mockResolvedValue(docOf('teacher-1', { role: 'teacher' }));

    const result = await requireTeacher(request);

    expect(result).toEqual({ ok: true, uid: 'teacher-1' });
    expect(getDoc).toHaveBeenCalledWith('users', 'teacher-1');
  });

  it('fails closed when the caller has no user document', async () => {
    verifyRequest.mockResolvedValue({ uid: 'ghost', missingToken: false, verificationUnavailable: false });
    getDoc.mockResolvedValue(docOf('ghost', null));

    const result = await requireTeacher(request);

    expect(result).toEqual({ ok: false, reason: 'not_a_teacher' });
  });
});

describe('requireClassroomOwner', () => {
  beforeEach(() => {
    verifyRequest.mockResolvedValue({
      uid: 'teacher-a',
      missingToken: false,
      verificationUnavailable: false,
    });
  });

  it('admits the owning teacher and returns the stored classroom', async () => {
    getDoc.mockImplementation(async (collection: string) =>
      collection === 'users'
        ? docOf('teacher-a', { role: 'teacher' })
        : docOf('class-a', { teacherId: 'teacher-a', name: 'Algebra' }),
    );

    const result = await requireClassroomOwner(request, 'class-a');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.classroom.id).toBe('class-a');
      expect(result.classroom.name).toBe('Algebra');
    }
  });

  it('refuses a teacher who does not own the classroom', async () => {
    getDoc.mockImplementation(async (collection: string) =>
      collection === 'users'
        ? docOf('teacher-a', { role: 'teacher' })
        : docOf('class-b', { teacherId: 'teacher-b' }),
    );

    const result = await requireClassroomOwner(request, 'class-b');

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('gives the same answer for someone else\'s classroom as for a missing one', async () => {
    getDoc.mockImplementation(async (collection: string) =>
      collection === 'users' ? docOf('teacher-a', { role: 'teacher' }) : docOf('nope', null),
    );

    const missing = await requireClassroomOwner(request, 'nope');

    // Identical outcome, deliberately. A different status for "exists but not
    // yours" would let a teacher enumerate other teachers' classroom ids.
    expect(missing).toEqual({ ok: false, reason: 'not_found' });
    expect(teacherAuthResponseInit('not_found').status).toBe(404);
  });

  it('never reads the classroom when the caller is not a teacher', async () => {
    getDoc.mockResolvedValue(docOf('student-1', { role: 'student' }));

    const result = await requireClassroomOwner(request, 'class-a');

    expect(result).toEqual({ ok: false, reason: 'not_a_teacher' });
    expect(getDoc).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty classroom id instead of reading a document at an empty path', async () => {
    getDoc.mockResolvedValue(docOf('teacher-a', { role: 'teacher' }));

    const result = await requireClassroomOwner(request, '');

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('isActiveMember', () => {
  it('accepts an active member at the deterministic membership id', async () => {
    getDoc.mockResolvedValue(
      docOf('class-a__student-1', { status: 'active', userId: 'student-1' }),
    );

    await expect(isActiveMember('class-a', 'student-1')).resolves.toBe(true);
    expect(getDoc).toHaveBeenCalledWith('classroomMemberships', 'class-a__student-1');
  });

  it('refuses a removed member, so leaving a classroom ends the teacher\'s access', async () => {
    getDoc.mockResolvedValue(
      docOf('class-a__student-1', { status: 'removed', userId: 'student-1' }),
    );

    await expect(isActiveMember('class-a', 'student-1')).resolves.toBe(false);
  });

  it('refuses a student who was never enrolled', async () => {
    getDoc.mockResolvedValue(docOf('class-a__stranger', null));

    await expect(isActiveMember('class-a', 'stranger')).resolves.toBe(false);
  });

  it('refuses a membership document whose userId does not match', async () => {
    getDoc.mockResolvedValue(
      docOf('class-a__student-1', { status: 'active', userId: 'someone-else' }),
    );

    await expect(isActiveMember('class-a', 'student-1')).resolves.toBe(false);
  });
});
