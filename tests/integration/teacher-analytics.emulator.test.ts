import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionMetrics } from '@/lib/types/scoring';

/**
 * Cross-tenant regression for teacher analytics, against the Firestore emulator.
 *
 * One student belongs to two classrooms and also has private practice. The
 * active roster proves who may have evidence in a classroom; trusted session
 * provenance proves which of that student's evidence belongs there. This test
 * exercises both production teacher routes so a global `studentId` fan-out
 * cannot reappear behind an otherwise-correct ownership or membership check.
 */

process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = 'true';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085';

vi.mock('@/lib/firebase/verify-request', () => ({
  verifyRequest: async (req: { headers: { get: (name: string) => string | null } }) => {
    const authorization = req.headers.get('authorization');
    const uid =
      authorization === 'Bearer privacy-teacher-a'
        ? 'privacy-teacher-a'
        : authorization === 'Bearer privacy-teacher-b'
          ? 'privacy-teacher-b'
          : null;
    return {
      uid,
      missingToken: uid === null,
      verificationUnavailable: false,
    };
  },
}));

type AdminDb = (typeof import('@/lib/firebase/admin'))['adminDb'];
type AnalyticsServer = typeof import('@/lib/analytics/classroom-server');
type AnalyticsRoute = typeof import('@/app/api/teacher/classrooms/[classroomId]/analytics/route');
type StudentRoute = typeof import('@/app/api/teacher/classrooms/[classroomId]/students/[studentId]/route');
type Independence = typeof import('@/lib/scoring/independence');

let adminDb: AdminDb;
let analytics: AnalyticsServer;
let analyticsRoute: AnalyticsRoute;
let studentRoute: StudentRoute;
let independence: Independence;

const TEACHER_A = 'privacy-teacher-a';
const TEACHER_B = 'privacy-teacher-b';
const CLASS_A = 'privacy-class-a';
const CLASS_B = 'privacy-class-b';
const CLASS_ASSIGNMENT = 'privacy-class-assignment';
const STUDENT = 'privacy-student-shared';

const SESSION_A = 'privacy-session-a';
const SESSION_B = 'privacy-session-b';
const SESSION_STANDALONE = 'privacy-session-standalone';
const SESSION_LEGACY = 'privacy-session-legacy';
const SESSION_UNTRUSTED_A = 'privacy-session-untrusted-a';
const SESSION_ASSIGNMENT_A = 'privacy-session-assignment-a';
const SESSION_ASSIGNMENT_FOREIGN = 'privacy-session-assignment-foreign';
const ASSIGNMENT_A = 'privacy-assignment-a';
const ASSIGNMENT_B = 'privacy-assignment-b';

const OCCURRED_AT = new Date('2026-08-13T02:00:00.000Z');

function sessionMetrics(
  sessionId: string,
  topic: string,
  options: {
    hintLevel: number;
    firstAttemptQuality: SessionMetrics['firstAttemptQuality'];
    transferOutcome: SessionMetrics['transfer']['outcome'];
  },
): SessionMetrics {
  return {
    sessionId,
    occurredAt: OCCURRED_AT,
    topic,
    subject: 'mathematics',
    mode: 'practice',
    endedWithSystemError: false,
    difficulty: 3,
    difficultySource: 'grade_default',
    firstAttemptQuality: options.firstAttemptQuality,
    firstAttemptState: 'observed',
    answerSeekingSignals: options.firstAttemptQuality === 'meaningful' ? 0 : 2,
    repeatedAnswerSeeking: options.firstAttemptQuality === 'none',
    highestHintUsed: options.hintLevel,
    allowedHintLevel: 7,
    hintState: 'observed',
    receivedFullSolution: false,
    accommodationHintLevels: [],
    studentTurnCount: 4,
    reasoningRubric: {
      identifiedMethod: options.firstAttemptQuality === 'meaningful',
      explainedIntermediateStep: options.firstAttemptQuality === 'meaningful',
      connectedToConcept: options.firstAttemptQuality === 'meaningful',
      interpretedResult: options.transferOutcome === 'independent_correct',
      confidence: 1,
      evidenceSpans: [],
    },
    reasoningState: 'observed',
    transfer: {
      issued: true,
      declined: false,
      outcome: options.transferOutcome,
      correctnessSource: 'deterministic',
      confidence: 1,
      referenceAnswer: 'trusted reference',
      studentAnswer: 'student answer',
    },
    transferState: 'observed',
    verificationRubric: {
      recomputedOrSubstituted: options.firstAttemptQuality === 'meaningful',
      checkedUnitsOrPlausibility: options.firstAttemptQuality === 'meaningful',
      statedAssumptionOrLimitation: false,
      correctlyJudgedContent: options.transferOutcome === 'independent_correct',
      confidence: 1,
    },
    verificationState: 'observed',
  };
}

const METRICS_A = sessionMetrics(SESSION_A, 'linear-equations', {
  hintLevel: 1,
  firstAttemptQuality: 'meaningful',
  transferOutcome: 'independent_correct',
});
const METRICS_B = sessionMetrics(SESSION_B, 'geometry', {
  hintLevel: 6,
  firstAttemptQuality: 'none',
  transferOutcome: 'attempted_incorrect',
});
const METRICS_STANDALONE = sessionMetrics(SESSION_STANDALONE, 'private-practice', {
  hintLevel: 0,
  firstAttemptQuality: 'meaningful',
  transferOutcome: 'independent_correct',
});
const METRICS_LEGACY = sessionMetrics(SESSION_LEGACY, 'legacy-practice', {
  hintLevel: 7,
  firstAttemptQuality: 'none',
  transferOutcome: 'attempted_incorrect',
});
const METRICS_UNTRUSTED_A = sessionMetrics(SESSION_UNTRUSTED_A, 'untrusted-legacy', {
  hintLevel: 7,
  firstAttemptQuality: 'none',
  transferOutcome: 'attempted_incorrect',
});

async function seedSession(options: {
  sessionId: string;
  score: number;
  errorCategory: string;
  metrics: SessionMetrics;
  scope?: 'standalone' | 'classroom' | 'assignment';
  classroomId?: string;
  assignmentId?: string;
}) {
  const session: Record<string, unknown> = {
    studentId: STUDENT,
    subject: 'mathematics',
    topic: options.metrics.topic,
    grade: 7,
    mode: 'practice',
    status: 'completed',
    startedAt: OCCURRED_AT,
    completedAt: OCCURRED_AT,
  };
  if (options.scope) session.scope = options.scope;
  if (options.classroomId) session.classroomId = options.classroomId;
  if (options.assignmentId) session.assignmentId = options.assignmentId;

  await adminDb.collection('learningSessions').doc(options.sessionId).set(session);
  await adminDb
    .collection('independenceSnapshotsInternal')
    .doc(`${options.sessionId}__scoring-v2`)
    .set({
      studentId: STUDENT,
      sessionId: options.sessionId,
      kind: 'session',
      totalScore: options.score,
      coverage: 1,
      suppressed: false,
      excludedForSystemError: false,
      scoringVersion: 'scoring-v2',
      generatedAt: OCCURRED_AT,
      rawMetrics: options.metrics,
    });
  await adminDb.collection('studentAttempts').doc(`attempt-${options.sessionId}`).set({
    sessionId: options.sessionId,
    studentId: STUDENT,
    attemptText: `private writing from ${options.sessionId}`,
    attemptType: 'initial',
    evaluation: { errorCategory: options.errorCategory },
  });
  await adminDb.collection('reports').doc(`report-${options.sessionId}`).set({
    sessionId: options.sessionId,
    reporterId: STUDENT,
    status: 'open',
    createdAt: OCCURRED_AT,
  });
}

async function seed() {
  await Promise.all([
    adminDb.collection('users').doc(TEACHER_A).set({
      id: TEACHER_A,
      role: 'teacher',
      displayName: 'Teacher A',
    }),
    adminDb.collection('users').doc(TEACHER_B).set({
      id: TEACHER_B,
      role: 'teacher',
      displayName: 'Teacher B',
    }),
    adminDb.collection('users').doc(STUDENT).set({
      id: STUDENT,
      role: 'student',
      displayName: 'Shared Student',
    }),
    adminDb.collection('classrooms').doc(CLASS_A).set({
      name: 'Classroom A',
      teacherId: TEACHER_A,
      grade: 7,
      subject: 'mathematics',
      joinCodeHash: 'PRIVAA',
      defaultStrictness: 'balanced',
    }),
    adminDb.collection('classrooms').doc(CLASS_B).set({
      name: 'Classroom B',
      teacherId: TEACHER_B,
      grade: 7,
      subject: 'mathematics',
      joinCodeHash: 'PRIVBB',
      defaultStrictness: 'balanced',
    }),
    adminDb.collection('classroomMemberships').doc(`${CLASS_A}__${STUDENT}`).set({
      classroomId: CLASS_A,
      userId: STUDENT,
      role: 'student',
      status: 'active',
    }),
    adminDb.collection('classroomMemberships').doc(`${CLASS_B}__${STUDENT}`).set({
      classroomId: CLASS_B,
      userId: STUDENT,
      role: 'student',
      status: 'active',
    }),
  ]);

  await Promise.all([
    seedSession({
      sessionId: SESSION_A,
      scope: 'classroom',
      classroomId: CLASS_A,
      score: 80,
      errorCategory: 'algebra_error',
      metrics: METRICS_A,
    }),
    seedSession({
      sessionId: SESSION_B,
      scope: 'classroom',
      classroomId: CLASS_B,
      score: 30,
      errorCategory: 'concept_error',
      metrics: METRICS_B,
    }),
    seedSession({
      sessionId: SESSION_STANDALONE,
      scope: 'standalone',
      score: 95,
      errorCategory: 'standalone_error',
      metrics: METRICS_STANDALONE,
    }),
    // No provenance: current membership must never guess this session into A.
    seedSession({
      sessionId: SESSION_LEGACY,
      score: 99,
      errorCategory: 'legacy_error',
      metrics: METRICS_LEGACY,
    }),
    // Even a legacy classroomId is untrusted without a coherent server scope.
    seedSession({
      sessionId: SESSION_UNTRUSTED_A,
      classroomId: CLASS_A,
      score: 5,
      errorCategory: 'untrusted_classroom_error',
      metrics: METRICS_UNTRUSTED_A,
    }),
  ]);

  // These student-wide records deliberately conflict with the classroom data.
  // A teacher loader must not query or use either one.
  await adminDb
    .collection('independenceSnapshotsInternal')
    .doc(`${STUDENT}__profile__scoring-v2`)
    .set({
      studentId: STUDENT,
      sessionId: null,
      kind: 'profile',
      totalScore: 5,
      band: 'needs_structured_practice',
      trend: -40,
      coverage: 100,
      suppressed: false,
      scoringVersion: 'scoring-v2',
      generatedAt: OCCURRED_AT,
    });
  await adminDb.collection('masteryRecords').doc(`${STUDENT}__global-secret-topic`).set({
    studentId: STUDENT,
    subject: 'mathematics',
    topic: 'global-secret-topic',
    guidedAccuracy: 0.01,
    independentAccuracy: 0.99,
    averageHintLevel: 7,
    transferSuccessRate: 0,
    sessionCount: 100,
  });
}

function request(url: string, teacherId: string) {
  return new NextRequest(url, {
    headers: { Authorization: `Bearer ${teacherId}` },
  });
}

beforeAll(async () => {
  adminDb = (await import('@/lib/firebase/admin')).adminDb;
  analytics = await import('@/lib/analytics/classroom-server');
  analyticsRoute = await import('@/app/api/teacher/classrooms/[classroomId]/analytics/route');
  studentRoute = await import(
    '@/app/api/teacher/classrooms/[classroomId]/students/[studentId]/route'
  );
  independence = await import('@/lib/scoring/independence');
  await seed();
});

describe('teacher analytics are bounded by trusted classroom session provenance', () => {
  it('loads only the one session provably bound to Classroom A', async () => {
    const evidence = await analytics.loadEvidenceForClassroom(CLASS_A, [STUDENT]);

    expect(evidence.sessions.map((session) => session.id)).toEqual([SESSION_A]);
    expect(evidence.snapshots.map((snapshot) => snapshot.sessionId)).toEqual([SESSION_A]);
    expect(evidence.attempts.map((attempt) => attempt.sessionId)).toEqual([SESSION_A]);
    expect(evidence.reports.map((report) => report.sessionId)).toEqual([SESSION_A]);
  });

  it('requires the assignment document to prove assignment provenance', async () => {
    await Promise.all([
      adminDb.collection('assignments').doc(ASSIGNMENT_A).set({
        classroomId: CLASS_ASSIGNMENT,
        teacherId: TEACHER_A,
        status: 'active',
      }),
      adminDb.collection('assignments').doc(ASSIGNMENT_B).set({
        classroomId: CLASS_B,
        teacherId: TEACHER_B,
        status: 'active',
      }),
      seedSession({
        sessionId: SESSION_ASSIGNMENT_A,
        scope: 'assignment',
        classroomId: CLASS_ASSIGNMENT,
        assignmentId: ASSIGNMENT_A,
        score: 80,
        errorCategory: 'assignment_error',
        metrics: sessionMetrics(SESSION_ASSIGNMENT_A, 'assignment-linear-equations', {
          hintLevel: 1,
          firstAttemptQuality: 'meaningful',
          transferOutcome: 'independent_correct',
        }),
      }),
      seedSession({
        sessionId: SESSION_ASSIGNMENT_FOREIGN,
        scope: 'assignment',
        classroomId: CLASS_ASSIGNMENT,
        assignmentId: ASSIGNMENT_B,
        score: 1,
        errorCategory: 'foreign_assignment_error',
        metrics: sessionMetrics(SESSION_ASSIGNMENT_FOREIGN, 'foreign-assignment-topic', {
          hintLevel: 7,
          firstAttemptQuality: 'none',
          transferOutcome: 'attempted_incorrect',
        }),
      }),
    ]);

    const evidence = await analytics.loadEvidenceForClassroom(CLASS_ASSIGNMENT, [STUDENT]);

    expect(evidence.sessions.map((session) => session.id)).toEqual([SESSION_ASSIGNMENT_A]);
    expect(evidence.snapshots.map((snapshot) => snapshot.sessionId)).toEqual([
      SESSION_ASSIGNMENT_A,
    ]);
    expect(evidence.attempts.map((attempt) => attempt.sessionId)).toEqual([
      SESSION_ASSIGNMENT_A,
    ]);
    expect(evidence.reports.map((report) => report.sessionId)).toEqual([
      SESSION_ASSIGNMENT_A,
    ]);
    expect(JSON.stringify(evidence)).not.toContain('foreign_assignment_error');
  });

  it('returns only A-derived analytics to Teacher A', async () => {
    const response = await analyticsRoute.GET(
      request(`http://localhost/api/teacher/classrooms/${CLASS_A}/analytics`, TEACHER_A),
      { params: Promise.resolve({ classroomId: CLASS_A }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const expectedProfile = independence.computeIndependenceProfile([METRICS_A]);

    expect(body.analytics.memberCount).toBe(1);
    expect(body.analytics.roster).toHaveLength(1);
    expect(body.analytics.roster[0].studentId).toBe(STUDENT);
    expect(body.analytics.roster[0].score).toBe(expectedProfile.score);
    expect(body.analytics.sessionsCompletedTotal).toBe(1);
    expect(body.analytics.independenceTrend).toEqual([
      expect.objectContaining({ average: 80, observed: 1 }),
    ]);
    expect(body.analytics.averageHintLevel.value).toBe(1);
    expect(body.analytics.transferSuccessRate.value).toBe(1);
    expect(body.analytics.commonErrorCategories).toEqual([
      { category: 'algebra_error', count: 1 },
    ]);
    expect(body.analytics.topicMastery.map((cell: { topic: string }) => cell.topic)).toEqual([
      'linear-equations',
    ]);
    expect(body.analytics.totalReportCount).toBe(1);
    expect(body.analytics.openReportCount).toBe(1);

    const serialized = JSON.stringify(body.analytics);
    expect(serialized).not.toContain('concept_error');
    expect(serialized).not.toContain('standalone_error');
    expect(serialized).not.toContain('legacy_error');
    expect(serialized).not.toContain('untrusted_classroom_error');
    expect(serialized).not.toContain('global-secret-topic');
  });

  it('returns only B-derived analytics to Teacher B', async () => {
    const response = await analyticsRoute.GET(
      request(`http://localhost/api/teacher/classrooms/${CLASS_B}/analytics`, TEACHER_B),
      { params: Promise.resolve({ classroomId: CLASS_B }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const expectedProfile = independence.computeIndependenceProfile([METRICS_B]);

    expect(body.analytics.roster).toHaveLength(1);
    expect(body.analytics.roster[0].score).toBe(expectedProfile.score);
    expect(body.analytics.sessionsCompletedTotal).toBe(1);
    expect(body.analytics.independenceTrend).toEqual([
      expect.objectContaining({ average: 30, observed: 1 }),
    ]);
    expect(body.analytics.averageHintLevel.value).toBe(6);
    expect(body.analytics.transferSuccessRate.value).toBe(0);
    expect(body.analytics.commonErrorCategories).toEqual([
      { category: 'concept_error', count: 1 },
    ]);
    expect(body.analytics.topicMastery.map((cell: { topic: string }) => cell.topic)).toEqual([
      'geometry',
    ]);
    expect(JSON.stringify(body.analytics)).not.toContain('algebra_error');
  });

  it('does not let Teacher A use the route to inspect Teacher B\'s classroom', async () => {
    const response = await analyticsRoute.GET(
      request(`http://localhost/api/teacher/classrooms/${CLASS_B}/analytics`, TEACHER_A),
      { params: Promise.resolve({ classroomId: CLASS_B }) },
    );

    expect(response.status).toBe(404);
  });
});

describe('the individual teacher student route remains classroom-scoped', () => {
  it('returns only Classroom A sessions and evidence for the shared student', async () => {
    const response = await studentRoute.GET(
      request(
        `http://localhost/api/teacher/classrooms/${CLASS_A}/students/${STUDENT}`,
        TEACHER_A,
      ),
      { params: Promise.resolve({ classroomId: CLASS_A, studentId: STUDENT }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const expectedProfile = independence.computeIndependenceProfile([METRICS_A]);

    expect(body.student).toEqual(
      expect.objectContaining({ studentId: STUDENT, classroomId: CLASS_A }),
    );
    expect(body.summary.score).toBe(expectedProfile.score);
    expect(body.summary.averageHintLevel.value).toBe(1);
    expect(body.summary.transferSuccessRate.value).toBe(1);
    expect(body.sessions).toEqual([
      expect.objectContaining({
        sessionId: SESSION_A,
        score: 80,
        highestHintUsed: 1,
        transferOutcome: 'independent_correct',
      }),
    ]);
    expect(body.commonErrorCategories).toEqual([{ category: 'algebra_error', count: 1 }]);
    expect(body.topicMastery.map((cell: { topic: string }) => cell.topic)).toEqual([
      'linear-equations',
    ]);
    expect(body.transcriptAvailable).toBe(false);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(SESSION_B);
    expect(serialized).not.toContain(SESSION_STANDALONE);
    expect(serialized).not.toContain(SESSION_LEGACY);
    expect(serialized).not.toContain(SESSION_UNTRUSTED_A);
    expect(serialized).not.toContain('concept_error');
    expect(serialized).not.toContain('standalone_error');
    expect(serialized).not.toContain('global-secret-topic');
  });
});
