import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = 'true';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085';

type AdminDb = (typeof import('@/lib/firebase/admin'))['adminDb'];
type SessionRoute = typeof import('@/app/api/session/route');

const authState = vi.hoisted(() => ({
  uid: 'session-create-student-a' as string | null,
  verificationUnavailable: false,
}));

vi.mock('@/lib/firebase/verify-request', () => ({
  verifyRequest: async () => ({ ...authState }),
}));

const STUDENT_A = 'session-create-student-a';
const STUDENT_B = 'session-create-student-b';
const TEACHER = 'session-create-teacher';
const CLASS_A = 'session-create-class-a';
const CLASS_B = 'session-create-class-b';
const ASSIGNMENT = 'session-create-assignment';
const FOREIGN_ASSIGNMENT = 'session-create-foreign-assignment';
const INACTIVE_ASSIGNMENT = 'session-create-inactive-assignment';

let adminDb: AdminDb;
let sessionRoute: SessionRoute;

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function createSession(body: Record<string, unknown>) {
  return sessionRoute.POST(request(body));
}

beforeAll(async () => {
  adminDb = (await import('@/lib/firebase/admin')).adminDb;
  sessionRoute = await import('@/app/api/session/route');

  await Promise.all([
    adminDb.collection('users').doc(STUDENT_A).set({
      id: STUDENT_A,
      role: 'student',
      preferredLanguage: 'en',
    }),
    adminDb.collection('users').doc(STUDENT_B).set({
      id: STUDENT_B,
      role: 'student',
      preferredLanguage: 'en',
    }),
    adminDb.collection('users').doc(TEACHER).set({
      id: TEACHER,
      role: 'teacher',
      preferredLanguage: 'en',
    }),
    adminDb.collection('studentProfiles').doc(STUDENT_A).set({
      userId: STUDENT_A,
      preferredLanguage: 'vi',
    }),
    adminDb.collection('classrooms').doc(CLASS_A).set({
      id: CLASS_A,
      teacherId: TEACHER,
      subject: 'mathematics',
      grade: 9,
      defaultStrictness: 'independence',
    }),
    adminDb.collection('classrooms').doc(CLASS_B).set({
      id: CLASS_B,
      teacherId: 'session-create-other-teacher',
      subject: 'science',
      grade: 8,
      defaultStrictness: 'balanced',
    }),
    adminDb.collection('classroomMemberships').doc(`${CLASS_A}__${STUDENT_A}`).set({
      classroomId: CLASS_A,
      userId: STUDENT_A,
      role: 'student',
      status: 'active',
    }),
    adminDb.collection('assignments').doc(ASSIGNMENT).set({
      id: ASSIGNMENT,
      classroomId: CLASS_A,
      teacherId: TEACHER,
      subject: 'physics',
      topic: 'constant acceleration',
      grade: 10,
      strictness: 'assessment_safe',
      allowedModes: ['practice', 'verify'],
      status: 'active',
    }),
    adminDb.collection('assignments').doc(FOREIGN_ASSIGNMENT).set({
      id: FOREIGN_ASSIGNMENT,
      classroomId: CLASS_B,
      teacherId: 'session-create-other-teacher',
      subject: 'science',
      grade: 8,
      strictness: 'balanced',
      allowedModes: ['practice'],
      status: 'active',
    }),
    adminDb.collection('assignments').doc(INACTIVE_ASSIGNMENT).set({
      id: INACTIVE_ASSIGNMENT,
      classroomId: CLASS_A,
      teacherId: TEACHER,
      subject: 'mathematics',
      grade: 9,
      strictness: 'balanced',
      allowedModes: ['practice'],
      status: 'archived',
    }),
    adminDb.collection('problemImages').doc('session-create-owned-image').set({
      id: 'session-create-owned-image',
      studentId: STUDENT_A,
    }),
    adminDb.collection('problemImages').doc('session-create-foreign-image').set({
      id: 'session-create-foreign-image',
      studentId: STUDENT_B,
    }),
  ]);
});

beforeEach(() => {
  authState.uid = STUDENT_A;
  authState.verificationUnavailable = false;
});

describe('POST /api/session trusted provenance', () => {
  it('creates a classroom session with server-owned tenant bindings and counters', async () => {
    const response = await createSession({
      classroomId: CLASS_A,
      originalProblem: 'Solve 3x + 4 = 19',
      mode: 'practice',
      imageId: 'session-create-owned-image',
    });

    expect(response.status).toBe(201);
    const { sessionId } = await response.json();
    const snapshot = await adminDb.collection('learningSessions').doc(sessionId).get();

    expect(snapshot.exists).toBe(true);
    expect(snapshot.data()).toMatchObject({
      studentId: STUDENT_A,
      scope: 'classroom',
      classroomId: CLASS_A,
      subject: 'mathematics',
      grade: 9,
      language: 'vi',
      mode: 'practice',
      strictness: 'independence',
      status: 'active',
      originalProblem: 'Solve 3x + 4 = 19',
      imageId: 'session-create-owned-image',
      currentHintLevel: 0,
      nextTurnSequence: 0,
      revision: 0,
      policyVersion: 'policy-v2',
      scoringVersion: 'scoring-v2',
    });
    expect(snapshot.data()).not.toHaveProperty('assignmentId');
    expect(snapshot.data()?.startedAt).toBeTruthy();
  });

  it('creates an assignment session only in an allowed mode and stamps the assignment', async () => {
    const response = await createSession({
      classroomId: CLASS_A,
      assignmentId: ASSIGNMENT,
      originalProblem: 'A car accelerates from rest. Find its speed after 5 seconds.',
      mode: 'verify',
    });

    expect(response.status).toBe(201);
    const { sessionId } = await response.json();
    const session = (await adminDb.collection('learningSessions').doc(sessionId).get()).data();

    expect(session).toMatchObject({
      studentId: STUDENT_A,
      scope: 'assignment',
      classroomId: CLASS_A,
      assignmentId: ASSIGNMENT,
      subject: 'physics',
      topic: 'constant acceleration',
      grade: 10,
      mode: 'verify',
      strictness: 'assessment_safe',
      currentHintLevel: 0,
      nextTurnSequence: 0,
      revision: 0,
    });
  });

  it('rejects a student who is not an active classroom member', async () => {
    authState.uid = STUDENT_B;

    const response = await createSession({
      classroomId: CLASS_A,
      originalProblem: 'Solve x = 2',
      mode: 'practice',
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Classroom session is not available.' });
  });

  it.each([
    ['another classroom', FOREIGN_ASSIGNMENT],
    ['an archived assignment', INACTIVE_ASSIGNMENT],
  ])('rejects %s', async (_label, assignmentId) => {
    const response = await createSession({
      classroomId: CLASS_A,
      assignmentId,
      originalProblem: 'Solve x = 2',
      mode: 'practice',
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Assignment session is not available.' });
  });

  it('rejects a mode the assignment does not allow', async () => {
    const response = await createSession({
      classroomId: CLASS_A,
      assignmentId: ASSIGNMENT,
      originalProblem: 'Solve x = 2',
      mode: 'learn',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'That learning mode is not allowed for this assignment.',
    });
  });

  it('rejects an authenticated user without the student role', async () => {
    authState.uid = TEACHER;

    const response = await createSession({
      classroomId: CLASS_A,
      originalProblem: 'Solve x = 2',
      mode: 'practice',
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Student role required.' });
  });

  it("rejects another student's image", async () => {
    const response = await createSession({
      classroomId: CLASS_A,
      originalProblem: 'Solve x = 2',
      mode: 'practice',
      imageId: 'session-create-foreign-image',
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Problem image is not available.' });
  });
});
