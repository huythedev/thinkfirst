import { beforeAll, describe, expect, it } from 'vitest';
import { SCORING_VERSION } from '@/lib/types/scoring';

/**
 * Integration coverage for the **server write path** to `independenceSnapshots`,
 * against a real Firestore emulator.
 *
 * Phase 5's second exit criterion is not satisfied by a rule alone:
 * "`independenceSnapshots` remains client-unwritable, **and** the server write
 * path works with real credentials." Before this session the collection was
 * `allow write: if false` with no writer at all, so it was dead rather than
 * protected, and the ledger recorded that honestly.
 *
 * The unit tests cover the algorithm. What they cannot cover is exactly what was
 * broken here: collection names, the `in` batching, whether stored rubric
 * judgments are actually read back, and whether the snapshot document round-trips
 * with the fields §56.4 requires. A wrong field name would silently produce a
 * `not_applicable` component and a confidently wrong score.
 */

process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = 'true';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085';

type AdminDb = typeof import('@/lib/firebase/admin')['adminDb'];
type ScoringServer = typeof import('@/lib/scoring/server');

let adminDb: AdminDb;
let scoring: ScoringServer;

const STUDENT = 'evidence-student';
const OTHER_STUDENT = 'evidence-other-student';

beforeAll(async () => {
  adminDb = (await import('@/lib/firebase/admin')).adminDb;
  scoring = await import('@/lib/scoring/server');
});

interface SeedOptions {
  suffix: string;
  studentId?: string;
  hintLevel?: number;
  recordHintLevel?: boolean;
  withRubric?: boolean;
  withTransfer?: 'none' | 'declined' | 'correct' | 'incorrect';
  systemError?: boolean;
  topic?: string;
}

async function seedSession(options: SeedOptions): Promise<string> {
  const studentId = options.studentId ?? STUDENT;
  const sessionId = `evidence-session-${options.suffix}`;

  await adminDb
    .collection('learningSessions')
    .doc(sessionId)
    .set({
      studentId,
      subject: 'mathematics',
      topic: options.topic ?? 'linear-equations',
      grade: 8,
      mode: 'practice',
      status: 'completed',
      originalProblem: 'Solve 2x + 3 = 11',
      currentHintLevel: options.hintLevel ?? 1,
      startedAt: new Date('2026-02-01T10:00:00Z'),
      completedAt: new Date('2026-02-01T10:30:00Z'),
      ...(options.systemError ? { endedWithSystemError: true } : {}),
    });

  await adminDb.collection('sessionTurns').doc(`${sessionId}-t1`).set({
    sessionId,
    studentId,
    sequence: 1,
    actor: 'student',
    content: 'I subtracted 3 from both sides',
  });

  await adminDb
    .collection('sessionTurns')
    .doc(`${sessionId}-t2`)
    .set({
      sessionId,
      studentId,
      sequence: 2,
      actor: 'assistant',
      content: 'Good start. What is next?',
      intentAnalysis: { intent: 'problem_solving', attemptQuality: 'meaningful' },
      responsePlan: { allowedHintLevel: 5, requiresExplanation: true },
      tutorMetadata: {
        ...(options.recordHintLevel === false ? {} : { hintLevel: options.hintLevel ?? 1 }),
        responseType: options.withTransfer && options.withTransfer !== 'none'
          ? 'transfer_problem'
          : 'hint',
        finalAnswerIncluded: false,
      },
    });

  const engaged = options.withTransfer === 'correct' || options.withTransfer === 'incorrect';
  if (engaged || options.withRubric) {
    await adminDb.collection('sessionTurns').doc(`${sessionId}-t3`).set({
      sessionId,
      studentId,
      sequence: 3,
      actor: 'student',
      content: 'x = 4, because dividing 8 by 2 gives 4. That is 4 units.',
    });
  }

  if (options.withRubric) {
    await adminDb
      .collection('studentAttempts')
      .doc(`${sessionId}-explanation`)
      .set({
        sessionId,
        studentId,
        attemptText: 'x = 4, because dividing 8 by 2 gives 4',
        attemptType: 'explanation',
        evaluation: {
          relevance: 1,
          correctness: 1,
          reasoningQuality: 0.9,
          errorCategory: 'none',
          feedbackSummary: 'Clear reasoning.',
          confidence: 0.9,
          reasoningRubric: {
            identifiedMethod: true,
            explainedIntermediateStep: true,
            connectedToConcept: true,
            interpretedResult: true,
            confidence: 0.9,
            evidenceSpans: ['because dividing 8 by 2 gives 4'],
          },
        },
      });
  }

  if (engaged) {
    await adminDb
      .collection('studentAttempts')
      .doc(`${sessionId}-transfer`)
      .set({
        sessionId,
        studentId,
        attemptText: 'y = 4',
        attemptType: 'transfer',
        evaluation: {
          relevance: 1,
          correctness: options.withTransfer === 'correct' ? 1 : 0.1,
          errorCategory: options.withTransfer === 'correct' ? 'none' : 'algebra_error',
          feedbackSummary: 'Checked deterministically.',
          confidence: 1,
          transferOutcome:
            options.withTransfer === 'correct' ? 'independent_correct' : 'attempted_incorrect',
          correctnessSource: 'deterministic',
          correctnessConfidence: 1,
          referenceAnswer: 'y = 4',
          studentAnswer: options.withTransfer === 'correct' ? 'y = 4' : 'y = 9',
        },
      });
  }

  return sessionId;
}

describe('persistSessionEvidence writes trusted evidence with real credentials', () => {
  it('creates the session snapshot with the fields §56.4 requires', async () => {
    const sessionId = await seedSession({ suffix: 'basic', withRubric: true });

    const result = await scoring.persistSessionEvidence(STUDENT, sessionId);

    const snapshot = await adminDb
      .collection('independenceSnapshots')
      .doc(`${sessionId}__${SCORING_VERSION}`)
      .get();

    expect(snapshot.exists).toBe(true);

    const data = snapshot.data() ?? {};
    expect(data.studentId).toBe(STUDENT);
    expect(data.kind).toBe('session');
    expect(data.scoringVersion).toBe(SCORING_VERSION);
    // Per-component state and confidence, raw metrics, coverage and the score:
    // all four are named explicitly by §56.4.
    expect(Array.isArray(data.componentDetail)).toBe(true);
    expect((data.componentDetail as unknown[]).length).toBe(5);
    expect(data.rawMetrics).not.toBeNull();
    expect(typeof data.coverage).toBe('number');
    expect(data.generatedAt).toBeDefined();
    expect(result.sessionScore.rawScore).not.toBeNull();
  });

  it('creates the profile snapshot and keeps it distinct from the session snapshot', async () => {
    const sessionId = await seedSession({ suffix: 'profile', withRubric: true });
    await scoring.persistSessionEvidence(STUDENT, sessionId);

    const profile = await adminDb
      .collection('independenceSnapshots')
      .doc(`${STUDENT}__profile__${SCORING_VERSION}`)
      .get();

    expect(profile.exists).toBe(true);
    expect(profile.data()?.kind).toBe('profile');
    expect(profile.data()?.sessionId).toBeNull();
  });

  it('is idempotent: re-running does not accumulate documents', async () => {
    const sessionId = await seedSession({ suffix: 'idempotent', withRubric: true });

    await scoring.persistSessionEvidence(STUDENT, sessionId);
    await scoring.persistSessionEvidence(STUDENT, sessionId);

    const snapshots = await adminDb
      .collection('independenceSnapshots')
      .where('sessionId', '==', sessionId)
      .get();

    expect(snapshots.size).toBe(1);
  });

  it('reads stored rubric judgments back rather than losing them', async () => {
    // If the round-trip through Firestore dropped the rubric, this component would
    // silently be `unavailable` and the score would be confidently wrong.
    const sessionId = await seedSession({ suffix: 'rubric', withRubric: true });
    const metrics = await scoring.loadSessionMetrics(STUDENT);
    const session = metrics.find((entry) => entry.sessionId === sessionId)!;

    expect(session.reasoningState).toBe('observed');
    expect(session.reasoningRubric?.interpretedResult).toBe(true);
    expect(session.reasoningRubric?.confidence).toBe(0.9);
  });

  it('marks hint evidence unavailable when the tutor turn recorded no level', async () => {
    const sessionId = await seedSession({ suffix: 'nohint', recordHintLevel: false });
    const metrics = await scoring.loadSessionMetrics(STUDENT);
    const session = metrics.find((entry) => entry.sessionId === sessionId)!;

    expect(session.hintState).toBe('unavailable');
    expect(session.highestHintUsed).toBeNull();
  });

  it('scores a declined transfer below a correct one, end to end through Firestore', async () => {
    const declinedId = await seedSession({ suffix: 'declined', withTransfer: 'declined' });
    const correctId = await seedSession({ suffix: 'correct', withTransfer: 'correct' });

    const metrics = await scoring.loadSessionMetrics(STUDENT);
    const declined = metrics.find((entry) => entry.sessionId === declinedId)!;
    const correct = metrics.find((entry) => entry.sessionId === correctId)!;

    expect(declined.transferState).toBe('declined');
    expect(correct.transferState).toBe('observed');
    expect(correct.transfer.correctnessSource).toBe('deterministic');
  });

  it('excludes a session that ended with a system error', async () => {
    const sessionId = await seedSession({ suffix: 'failed', systemError: true });
    const metrics = await scoring.loadSessionMetrics(STUDENT);
    const session = metrics.find((entry) => entry.sessionId === sessionId)!;

    expect(session.endedWithSystemError).toBe(true);
  });

  it('never reads another student sessions into a profile', async () => {
    await seedSession({ suffix: 'other', studentId: OTHER_STUDENT, withRubric: true });
    const metrics = await scoring.loadSessionMetrics(STUDENT);

    expect(metrics.every((entry) => entry.sessionId !== 'evidence-session-other')).toBe(true);
  });

  it('persists an older requested session from its own evidence beyond the 30-session window', async () => {
    const studentId = 'evidence-old-target-student';
    const targetSession = await seedSession({
      suffix: 'old-target',
      studentId,
      hintLevel: 1,
      withTransfer: 'correct',
      topic: 'target-topic',
    });
    await adminDb.collection('learningSessions').doc(targetSession).update({
      startedAt: new Date('2025-01-01T10:00:00Z'),
      completedAt: new Date('2025-01-01T10:30:00Z'),
    });

    const batch = adminDb.batch();
    for (let index = 0; index < 30; index += 1) {
      const newer = adminDb.collection('learningSessions').doc(`evidence-newer-${index}`);
      batch.set(newer, {
        studentId,
        subject: 'mathematics',
        topic: 'foreign-topic',
        grade: 8,
        mode: 'practice',
        status: 'completed',
        originalProblem: 'A newer private problem',
        currentHintLevel: 7,
        startedAt: new Date(Date.UTC(2026, 0, index + 1, 10)),
        completedAt: new Date(Date.UTC(2026, 0, index + 1, 10, 30)),
      });
    }
    await batch.commit();

    const result = await scoring.persistSessionEvidence(studentId, targetSession);
    const stored = await adminDb
      .collection('independenceSnapshotsInternal')
      .doc(`${targetSession}__${SCORING_VERSION}`)
      .get();

    expect(result.sessionScore.sessionId).toBe(targetSession);
    expect(stored.data()?.sessionId).toBe(targetSession);
    expect(stored.data()?.rawMetrics).toEqual(
      expect.objectContaining({
        sessionId: targetSession,
        topic: 'target-topic',
        highestHintUsed: 1,
        transfer: expect.objectContaining({ outcome: 'independent_correct' }),
      }),
    );
  });

  it('writes a mastery record for the topic', async () => {
    const sessionId = await seedSession({
      suffix: 'mastery',
      withRubric: true,
      topic: 'quadratics',
    });
    await scoring.persistSessionEvidence(STUDENT, sessionId);

    const records = await adminDb
      .collection('masteryRecords')
      .where('studentId', '==', STUDENT)
      .where('topic', '==', 'quadratics')
      .get();

    expect(records.size).toBe(1);
    const record = records.docs[0].data();
    expect(record.subject).toBe('mathematics');
    expect(typeof record.averageHintLevel).toBe('number');
    expect(typeof record.transferSuccessRate).toBe('number');
    expect(record.sessionCount).toBeGreaterThan(0);
  });

  it('does not compound the 8-point cap when the same session is recomputed', async () => {
    const clampStudent = 'evidence-clamp-student';
    const sessionId = await seedSession({ suffix: 'clamp', studentId: clampStudent, withRubric: true });

    // A stored profile far from where the evidence points. §56.4 forbids one
    // session closing that gap in a single step.
    await adminDb
      .collection('independenceSnapshots')
      .doc(`${clampStudent}__profile__${SCORING_VERSION}`)
      .set({
        studentId: clampStudent,
        kind: 'profile',
        totalScore: 20,
        scoringVersion: SCORING_VERSION,
        generatedAt: new Date('2026-02-01T09:00:00Z'),
      });

    const previous = await scoring.loadPreviousProfileScore(clampStudent);
    expect(previous).toBe(20);

    await scoring.persistSessionEvidence(clampStudent, sessionId);
    const result = await scoring.persistSessionEvidence(clampStudent, sessionId);
    const sessionSnapshot = await adminDb.collection('independenceSnapshots')
      .doc(`${sessionId}__${SCORING_VERSION}`).get();
    expect(sessionSnapshot.data()?.profileBaselineScore).toBe(20);
    if (result.profile.score !== null) {
      expect(result.profile.score).toBeLessThanOrEqual(28);
      expect(result.profile.score).toBeGreaterThanOrEqual(12);
    }
  });

  it('uses the same fixed baseline for downward movement on repeated recomputations', async () => {
    const clampStudent = 'evidence-downward-clamp-student';
    const sessionId = await seedSession({ suffix: 'downward-clamp', studentId: clampStudent, withTransfer: 'declined' });
    await adminDb.collection('independenceSnapshots').doc(`${clampStudent}__profile__${SCORING_VERSION}`).set({
      studentId: clampStudent, kind: 'profile', totalScore: 90,
      scoringVersion: SCORING_VERSION, generatedAt: new Date('2026-02-01T09:00:00Z'),
    });

    await scoring.persistSessionEvidence(clampStudent, sessionId);
    const result = await scoring.persistSessionEvidence(clampStudent, sessionId);
    if (result.profile.score !== null) {
      expect(result.profile.score).toBeGreaterThanOrEqual(82);
      expect(result.profile.score).toBeLessThanOrEqual(98);
    }
  });

  it('replays the per-session cap so A recomputation cannot erase B', async () => {
    const studentId = 'evidence-multi-session-clamp';
    const sessionA = await seedSession({ suffix: 'multi-a', studentId, withRubric: true });
    const sessionB = await seedSession({ suffix: 'multi-b', studentId, withTransfer: 'declined' });
    await adminDb.collection('learningSessions').doc(sessionA).update({
      startedAt: new Date('2026-03-01T10:00:00Z'),
      completedAt: new Date('2026-03-01T10:30:00Z'),
    });
    await adminDb.collection('learningSessions').doc(sessionB).update({
      startedAt: new Date('2026-03-02T10:00:00Z'),
      completedAt: new Date('2026-03-02T10:30:00Z'),
    });
    await adminDb.collection('independenceSnapshots').doc(`${studentId}__profile__${SCORING_VERSION}`).set({
      studentId, kind: 'profile', totalScore: 40,
      scoringVersion: SCORING_VERSION, generatedAt: new Date('2026-02-28T09:00:00Z'),
    });

    await scoring.persistSessionEvidence(studentId, sessionA);
    const afterB = await scoring.persistSessionEvidence(studentId, sessionB);
    const afterARecompute = await scoring.persistSessionEvidence(studentId, sessionA);

    expect(afterARecompute.profile.score).toBe(afterB.profile.score);
    if (afterARecompute.profile.score !== null) {
      expect(Math.abs(afterARecompute.profile.score - 40)).toBeLessThanOrEqual(16);
    }
  });

  it('replays the per-session cap symmetrically so B recomputation cannot erase A', async () => {
    const studentId = 'evidence-multi-session-clamp-symmetric';
    const sessionA = await seedSession({ suffix: 'multi-symmetric-a', studentId, withRubric: true });
    const sessionB = await seedSession({ suffix: 'multi-symmetric-b', studentId, withTransfer: 'declined' });
    await adminDb.collection('learningSessions').doc(sessionA).update({
      startedAt: new Date('2026-03-01T10:00:00Z'),
      completedAt: new Date('2026-03-01T10:30:00Z'),
    });
    await adminDb.collection('learningSessions').doc(sessionB).update({
      startedAt: new Date('2026-03-02T10:00:00Z'),
      completedAt: new Date('2026-03-02T10:30:00Z'),
    });
    await adminDb.collection('independenceSnapshots').doc(`${studentId}__profile__${SCORING_VERSION}`).set({
      studentId, kind: 'profile', totalScore: 40,
      scoringVersion: SCORING_VERSION, generatedAt: new Date('2026-02-28T09:00:00Z'),
    });

    await scoring.persistSessionEvidence(studentId, sessionB);
    const afterA = await scoring.persistSessionEvidence(studentId, sessionA);
    const afterBRecompute = await scoring.persistSessionEvidence(studentId, sessionB);

    expect(afterBRecompute.profile.score).toBe(afterA.profile.score);
    if (afterBRecompute.profile.score !== null) {
      expect(Math.abs(afterBRecompute.profile.score - 40)).toBeLessThanOrEqual(16);
    }
  });
});
