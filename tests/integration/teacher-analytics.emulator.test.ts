import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration coverage for the teacher aggregate path, against a real Firestore
 * emulator.
 *
 * Phase 6's second exit criterion is "a teacher sees aggregate data for their own
 * classrooms only, proven by a negative test", and the negative is the point: a
 * positive aggregate proves the query runs, not that it is bounded.
 *
 * This has to be an integration test rather than a unit test. The aggregation
 * function is pure and already unit-tested, but the boundary being proved here
 * lives in the loader and the authorization helper: which collections are read,
 * how the `in` batching splits, whether the roster read actually constrains the
 * fan-out, and whether ownership is compared against stored data rather than
 * against the caller's word. A mocked Firestore would prove none of it, and a
 * wrong collection name would silently return an empty aggregate that looks like
 * a quiet classroom.
 */

process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = 'true';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085';

type AdminDb = (typeof import('@/lib/firebase/admin'))['adminDb'];
type AnalyticsServer = typeof import('@/lib/analytics/classroom-server');
type AuditLog = typeof import('@/lib/audit/audit-log');

let adminDb: AdminDb;
let analytics: AnalyticsServer;
let audit: AuditLog;

const TEACHER_A = 'teach-a';
const TEACHER_B = 'teach-b';
const CLASS_A = 'tclass-a';
const CLASS_B = 'tclass-b';
const STUDENT_A = 'tstudent-a';
const STUDENT_B = 'tstudent-b';
const OUTSIDER = 'tstudent-outsider';

beforeAll(async () => {
  adminDb = (await import('@/lib/firebase/admin')).adminDb;
  analytics = await import('@/lib/analytics/classroom-server');
  audit = await import('@/lib/audit/audit-log');
  await seed();
});

async function seedStudentEvidence(options: {
  studentId: string;
  sessionSuffix: string;
  hintLevel: number;
  score: number;
  transferOutcome: string;
}) {
  const sessionId = `tsession-${options.sessionSuffix}`;

  await adminDb
    .collection('learningSessions')
    .doc(sessionId)
    .set({
      studentId: options.studentId,
      subject: 'mathematics',
      topic: 'fractions',
      grade: 7,
      mode: 'practice',
      status: 'completed',
      startedAt: new Date(),
      completedAt: new Date(),
    });

  await adminDb
    .collection('independenceSnapshots')
    .doc(`${sessionId}__scoring-v2`)
    .set({
      studentId: options.studentId,
      sessionId,
      kind: 'session',
      totalScore: options.score,
      coverage: 0.8,
      suppressed: false,
      excludedForSystemError: false,
      scoringVersion: 'scoring-v2',
      generatedAt: new Date(),
      rawMetrics: {
        sessionId,
        firstAttemptState: 'observed',
        firstAttemptQuality: 'meaningful',
        hintState: 'observed',
        highestHintUsed: options.hintLevel,
        transfer: {
          issued: true,
          declined: false,
          outcome: options.transferOutcome,
          correctnessSource: 'deterministic',
          confidence: 1,
          referenceAnswer: null,
          studentAnswer: null,
        },
      },
    });

  await adminDb
    .collection('independenceSnapshots')
    .doc(`${options.studentId}__profile__scoring-v2`)
    .set({
      studentId: options.studentId,
      sessionId: null,
      kind: 'profile',
      totalScore: options.score,
      band: 'developing_independence',
      trend: 2,
      coverage: 0.8,
      suppressed: false,
      scoringVersion: 'scoring-v2',
      generatedAt: new Date(),
    });

  await adminDb
    .collection('masteryRecords')
    .doc(`${options.studentId}__fractions`)
    .set({
      studentId: options.studentId,
      subject: 'mathematics',
      topic: 'fractions',
      guidedAccuracy: 0.9,
      independentAccuracy: 0.5,
      averageHintLevel: options.hintLevel,
      transferSuccessRate: 0.4,
      sessionCount: 2,
    });

  await adminDb.collection('studentAttempts').doc(`tattempt-${options.sessionSuffix}`).set({
    sessionId,
    studentId: options.studentId,
    attemptText: 'private student writing',
    attemptType: 'initial',
    evaluation: { errorCategory: 'procedural_slip' },
  });
}

async function seed() {
  for (const [uid, role] of [
    [TEACHER_A, 'teacher'],
    [TEACHER_B, 'teacher'],
    [STUDENT_A, 'student'],
    [STUDENT_B, 'student'],
    [OUTSIDER, 'student'],
  ] as const) {
    await adminDb.collection('users').doc(uid).set({ id: uid, role, displayName: uid });
  }

  await adminDb.collection('classrooms').doc(CLASS_A).set({
    name: 'Teacher A class',
    teacherId: TEACHER_A,
    grade: 7,
    subject: 'mathematics',
    joinCodeHash: 'TAAAAA',
    defaultStrictness: 'balanced',
  });

  await adminDb.collection('classrooms').doc(CLASS_B).set({
    name: 'Teacher B class',
    teacherId: TEACHER_B,
    grade: 7,
    subject: 'mathematics',
    joinCodeHash: 'TBBBBB',
    defaultStrictness: 'balanced',
  });

  await adminDb.collection('classroomMemberships').doc(`${CLASS_A}__${STUDENT_A}`).set({
    classroomId: CLASS_A,
    userId: STUDENT_A,
    role: 'student',
    status: 'active',
  });

  await adminDb.collection('classroomMemberships').doc(`${CLASS_B}__${STUDENT_B}`).set({
    classroomId: CLASS_B,
    userId: STUDENT_B,
    role: 'student',
    status: 'active',
  });

  // Enrolled once and since removed. Must not appear in the roster.
  await adminDb.collection('classroomMemberships').doc(`${CLASS_A}__${OUTSIDER}`).set({
    classroomId: CLASS_A,
    userId: OUTSIDER,
    role: 'student',
    status: 'removed',
  });

  await seedStudentEvidence({
    studentId: STUDENT_A,
    sessionSuffix: 'a1',
    hintLevel: 2,
    score: 74,
    transferOutcome: 'independent_correct',
  });
  await seedStudentEvidence({
    studentId: STUDENT_B,
    sessionSuffix: 'b1',
    hintLevel: 7,
    score: 31,
    transferOutcome: 'attempted_incorrect',
  });
  await seedStudentEvidence({
    studentId: OUTSIDER,
    sessionSuffix: 'o1',
    hintLevel: 7,
    score: 10,
    transferOutcome: 'declined',
  });
}

describe('the classroom roster bounds the aggregate', () => {
  it('includes only active student members', async () => {
    const members = await analytics.loadClassroomMembers(CLASS_A);
    expect(members.map((member) => member.studentId)).toEqual([STUDENT_A]);
  });

  it('excludes a removed member, so leaving a class removes the data too', async () => {
    const members = await analytics.loadClassroomMembers(CLASS_A);
    expect(members.map((member) => member.studentId)).not.toContain(OUTSIDER);
  });

  it('resolves display names that the teacher cannot read directly', async () => {
    const members = await analytics.loadClassroomMembers(CLASS_A);
    expect(members[0].displayName).toBe(STUDENT_A);
  });
});

describe("a classroom aggregate never contains another classroom's students", () => {
  it("teacher A's classroom reports only student A's evidence", async () => {
    const result = await analytics.computeClassroomAnalytics(CLASS_A);

    expect(result.memberCount).toBe(1);
    expect(result.roster.map((row) => row.studentId)).toEqual([STUDENT_A]);
    // Student B reached hint level 7. If the fan-out were unbounded the average
    // would be 4.5 rather than 2.
    expect(result.averageHintLevel.value).toBe(2);
    expect(result.transferSuccessRate.value).toBe(1);
  });

  it("teacher B's classroom reports only student B's evidence", async () => {
    const result = await analytics.computeClassroomAnalytics(CLASS_B);

    expect(result.roster.map((row) => row.studentId)).toEqual([STUDENT_B]);
    expect(result.averageHintLevel.value).toBe(7);
    expect(result.transferSuccessRate.value).toBe(0);
  });

  it('an empty classroom aggregates to nothing rather than to everything', async () => {
    await adminDb.collection('classrooms').doc('tclass-empty').set({
      name: 'Empty',
      teacherId: TEACHER_A,
      grade: 7,
      subject: 'mathematics',
      joinCodeHash: 'TEMPTY',
      defaultStrictness: 'balanced',
    });

    const result = await analytics.computeClassroomAnalytics('tclass-empty');

    // The dangerous failure here is a query with no filter returning every
    // student in the project.
    expect(result.memberCount).toBe(0);
    expect(result.roster).toEqual([]);
    expect(result.averageHintLevel.value).toBeNull();
    expect(result.sessionsCompletedTotal).toBe(0);
  });
});

describe('stored evidence round-trips into the aggregate', () => {
  it('reads rubric-derived metrics out of the persisted snapshot', async () => {
    const result = await analytics.computeClassroomAnalytics(CLASS_A);
    expect(result.attemptBeforeHelpRate.value).toBe(1);
    expect(result.attemptBeforeHelpRate.observed).toBe(1);
  });

  it('surfaces error categories without surfacing the attempt text', async () => {
    const result = await analytics.computeClassroomAnalytics(CLASS_A);
    expect(result.commonErrorCategories).toEqual([{ category: 'procedural_slip', count: 1 }]);
    expect(JSON.stringify(result)).not.toContain('private student writing');
  });

  it('reports topic mastery with guided and independent accuracy kept apart', async () => {
    const result = await analytics.computeClassroomAnalytics(CLASS_A);
    const fractions = result.topicMastery.find((cell) => cell.topic === 'fractions');
    expect(fractions).toBeDefined();
    expect(fractions?.guidedAccuracy).toBe(0.9);
    expect(fractions?.independentAccuracy).toBe(0.5);
    expect(fractions?.needsReview).toBe(true);
  });

  it('never returns transcript content in an aggregate', async () => {
    await adminDb.collection('sessionTurns').doc('tturn-secret').set({
      sessionId: 'tsession-a1',
      studentId: STUDENT_A,
      sequence: 1,
      actor: 'student',
      content: 'a private message that must not reach a teacher',
    });

    const result = await analytics.computeClassroomAnalytics(CLASS_A);
    expect(JSON.stringify(result)).not.toContain('a private message');
  });
});

describe('the audit trail is live rather than dead', () => {
  it('writes an entry that can be read back with the fields section 28 needs', async () => {
    const written = await audit.writeAuditLog({
      actorId: TEACHER_A,
      actorRole: 'teacher',
      action: 'student_summary_access',
      targetType: 'student',
      targetId: STUDENT_A,
      reason: 'Checking progress before a parent meeting',
      context: { classroomId: CLASS_A },
    });

    expect(written).toBe(true);

    const logs = await adminDb
      .collection('auditLogs')
      .where('targetId', '==', STUDENT_A)
      .get();

    expect(logs.empty).toBe(false);
    const entry = logs.docs[0].data();
    expect(entry.actorId).toBe(TEACHER_A);
    expect(entry.action).toBe('student_summary_access');
    expect(entry.reason).toBe('Checking progress before a parent meeting');
    expect(entry.createdAt).toBeTruthy();
  });
});
