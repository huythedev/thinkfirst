import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration coverage for the trusted policy-input reads, against a real
 * Firestore emulator.
 *
 * `tests/policy/policy-inputs.test.ts` covers the precedence logic as a pure
 * function. What it cannot cover is the Firestore wiring: the collection names,
 * the ownership check, the assignment-belongs-to-classroom check, and the
 * transcript ordering/provenance. Those are exactly the parts that would silently
 * resolve to a default if a field name were wrong, and a silent default here
 * means a policy decision made on the wrong data.
 */

process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = 'true';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085';

type AdminDb = typeof import('@/lib/firebase/admin')['adminDb'];
type PolicyInputs = typeof import('@/lib/session/policy-inputs');

let adminDb: AdminDb;
let policyInputs: PolicyInputs;

const STUDENT = 'integration-student';
const OTHER_STUDENT = 'integration-other-student';

beforeAll(async () => {
  adminDb = (await import('@/lib/firebase/admin')).adminDb;
  policyInputs = await import('@/lib/session/policy-inputs');
});

async function seedClassroomSession(suffix: string, overrides: Record<string, unknown> = {}) {
  const classroomId = `int-class-${suffix}`;
  const sessionId = `int-session-${suffix}`;

  await adminDb.collection('classrooms').doc(classroomId).set({
    id: classroomId,
    name: 'Integration classroom',
    teacherId: 'integration-teacher',
    grade: 11,
    subject: 'mathematics',
    defaultStrictness: 'assessment_safe',
  });

  await adminDb.collection('learningSessions').doc(sessionId).set({
    studentId: STUDENT,
    classroomId,
    subject: 'mathematics',
    grade: 8,
    language: 'en',
    mode: 'learn',
    strictness: 'supportive',
    status: 'active',
    originalProblem: 'Solve 2x + 3 = 11',
    currentHintLevel: 6,
    ...overrides,
  });

  return { classroomId, sessionId };
}

describe('resolvePolicyInputs against the emulator', () => {
  it('reads strictness from the classroom, not from the session the client wrote', async () => {
    const { sessionId } = await seedClassroomSession('basic');

    const result = await policyInputs.resolvePolicyInputs(sessionId, STUDENT);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.inputs.strictness).toBe('assessment_safe');
    expect(result.inputs.sources.strictness).toBe('classroom');
    expect(result.inputs.grade).toBe(11);
    expect(result.inputs.sources.grade).toBe('classroom');
  });

  it('reads the hint level from the session, which only the server writes', async () => {
    const { sessionId } = await seedClassroomSession('level', { currentHintLevel: 3 });

    const result = await policyInputs.resolvePolicyInputs(sessionId, STUDENT);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.inputs.currentHintLevel).toBe(3);
  });

  it('prefers an assignment over the classroom', async () => {
    const { classroomId, sessionId } = await seedClassroomSession('assigned');
    const assignmentId = 'int-assignment-1';

    await adminDb.collection('assignments').doc(assignmentId).set({
      id: assignmentId,
      classroomId,
      teacherId: 'integration-teacher',
      title: 'Integration assignment',
      grade: 9,
      strictness: 'independence',
      allowedModes: ['assignment'],
      allowFullSolutions: false,
      requireTransferProblem: true,
    });
    await adminDb.collection('learningSessions').doc(sessionId).update({ assignmentId });

    const result = await policyInputs.resolvePolicyInputs(sessionId, STUDENT);
    if (result.status !== 'ok') throw new Error('expected ok');

    expect(result.inputs.strictness).toBe('independence');
    expect(result.inputs.sources.strictness).toBe('assignment');
    expect(result.inputs.grade).toBe(9);
    expect(result.inputs.allowFullSolutions).toBe(false);
    expect(result.inputs.requireTransferProblem).toBe(true);
    expect(result.inputs.mode).toBe('assignment');
  });

  it('ignores an assignment that belongs to a different classroom', async () => {
    const { sessionId } = await seedClassroomSession('foreign-assignment');
    const assignmentId = 'int-assignment-foreign';

    await adminDb.collection('assignments').doc(assignmentId).set({
      id: assignmentId,
      classroomId: 'some-other-classroom',
      teacherId: 'integration-teacher',
      strictness: 'supportive',
      allowFullSolutions: true,
    });
    await adminDb.collection('learningSessions').doc(sessionId).update({ assignmentId });

    const result = await policyInputs.resolvePolicyInputs(sessionId, STUDENT);
    if (result.status !== 'ok') throw new Error('expected ok');

    expect(result.inputs.strictness).toBe('assessment_safe');
    expect(result.inputs.allowFullSolutions).toBeUndefined();
  });

  it('falls back to the student profile when the session has no classroom', async () => {
    await adminDb.collection('studentProfiles').doc(STUDENT).set({
      userId: STUDENT,
      grade: 5,
      assistanceProfile: { defaultStrictness: 'independence', accessibilitySettings: [] },
    });

    const sessionId = 'int-session-soloist';
    await adminDb.collection('learningSessions').doc(sessionId).set({
      studentId: STUDENT,
      subject: 'mathematics',
      grade: 12,
      language: 'en',
      mode: 'practice',
      strictness: 'supportive',
      status: 'active',
      originalProblem: 'Solve 2x + 3 = 11',
      currentHintLevel: 0,
    });

    const result = await policyInputs.resolvePolicyInputs(sessionId, STUDENT);
    if (result.status !== 'ok') throw new Error('expected ok');

    expect(result.inputs.strictness).toBe('independence');
    expect(result.inputs.sources.strictness).toBe('studentProfile');
    expect(result.inputs.grade).toBe(5);
  });

  it('refuses a session owned by another student', async () => {
    const { sessionId } = await seedClassroomSession('ownership');
    const result = await policyInputs.resolvePolicyInputs(sessionId, OTHER_STUDENT);
    expect(result.status).toBe('forbidden');
  });

  it('reports a missing session rather than inventing defaults', async () => {
    const result = await policyInputs.resolvePolicyInputs('no-such-session', STUDENT);
    expect(result.status).toBe('not_found');
  });
});

describe('loadTranscript against the emulator', () => {
  it('returns trusted turns in sequence order regardless of write order', async () => {
    const sessionId = 'int-session-transcript';

    await adminDb.collection('learningSessions').doc(sessionId).set({
      studentId: STUDENT,
      subject: 'mathematics',
      grade: 8,
      language: 'en',
      mode: 'practice',
      status: 'active',
      originalProblem: 'Solve 2x + 3 = 11',
      currentHintLevel: 0,
    });

    await adminDb.collection('sessionTurns').doc('int-turn-2').set({
      sessionId,
      studentId: STUDENT,
      sequence: 2,
      actor: 'assistant',
      content: 'What could you subtract from both sides?',
    });
    await adminDb.collection('sessionTurns').doc('int-turn-1').set({
      sessionId,
      studentId: STUDENT,
      sequence: 1,
      actor: 'student',
      content: 'How do I start?',
      serverAuthored: true,
    });

    const transcript = await policyInputs.loadTranscript(sessionId);
    expect(transcript.map(({ actor, content, sequence }) => ({ actor, content, sequence }))).toEqual([
      { actor: 'student', content: 'How do I start?', sequence: 1 },
      { actor: 'assistant', content: 'What could you subtract from both sides?', sequence: 2 },
    ]);
  });

  it('excludes an unmarked legacy student turn from trusted policy history', async () => {
    const sessionId = 'int-session-legacy-turn';
    await adminDb.collection('sessionTurns').doc('int-turn-legacy-student').set({
      sessionId,
      studentId: STUDENT,
      sequence: 1,
      actor: 'student',
      content: 'Fake old attempt that used to be client-creatable',
    });
    await adminDb.collection('sessionTurns').doc('int-turn-trusted-assistant').set({
      sessionId,
      studentId: STUDENT,
      sequence: 2,
      actor: 'assistant',
      content: 'Server-authored tutor history stays trusted.',
    });

    const transcript = await policyInputs.loadTranscript(sessionId);
    expect(transcript.map(({ actor, content, sequence }) => ({ actor, content, sequence }))).toEqual([
      {
        actor: 'assistant',
        content: 'Server-authored tutor history stays trusted.',
        sequence: 2,
      },
    ]);
  });

  it('does not leak another session transcript into this one', async () => {
    const sessionId = 'int-session-isolated';
    await adminDb.collection('sessionTurns').doc('int-turn-elsewhere').set({
      sessionId: 'int-session-somewhere-else',
      studentId: OTHER_STUDENT,
      sequence: 1,
      actor: 'student',
      content: 'a different conversation',
      serverAuthored: true,
    });

    const transcript = await policyInputs.loadTranscript(sessionId);
    expect(transcript).toEqual([]);
  });

  it('is empty for a session with no turns yet', async () => {
    const transcript = await policyInputs.loadTranscript('int-session-brand-new');
    expect(transcript).toEqual([]);
  });
});
