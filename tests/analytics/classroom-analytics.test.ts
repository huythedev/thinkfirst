import { describe, expect, it } from 'vitest';
import {
  STUDENT_FLAGS,
  aggregateClassroomAnalytics,
  type AnalyticsSessionRow,
  type AnalyticsSnapshotRow,
  type ClassroomAnalyticsInput,
} from '@/lib/analytics/classroom';
import { computeIndependenceProfile, scoreSession } from '@/lib/scoring/independence';
import { deriveMasteryRows } from '@/lib/scoring/mastery';
import type { SessionMetrics } from '@/lib/types/scoring';

/**
 * Unit coverage for classroom aggregation.
 *
 * Phase 6's first exit criterion says every number on the dashboard must be
 * derived from a query. That makes *how* the number is derived worth testing:
 * the failure mode this suite exists to prevent is not a crash, it is a
 * plausible-looking figure computed over evidence that was never there. Section
 * 56 already documented that class of defect for the Independence Score, and a
 * classroom average is the same trap one level up -- a rate of 0% over zero
 * observations reads as "students never attempt first" when it means "nobody has
 * measured anything yet".
 */

const NOW = new Date('2026-08-07T12:00:00Z');
const RECENT = new Date('2026-08-05T10:00:00Z');
const OLD = new Date('2026-05-01T10:00:00Z');

function emptyInput(): ClassroomAnalyticsInput {
  return {
    now: NOW,
    members: [],
    sessions: [],
    snapshots: [],
    attempts: [],
    reports: [],
  };
}

function classroomSession(
  overrides: Partial<AnalyticsSessionRow> = {},
): AnalyticsSessionRow {
  return {
    id: 'session-1',
    studentId: 'student-a',
    scope: 'classroom',
    classroomId: 'class-1',
    status: 'completed',
    startedAt: RECENT,
    completedAt: RECENT,
    subject: 'mathematics',
    topic: 'fractions',
    ...overrides,
  };
}

function snapshot(overrides: Partial<AnalyticsSnapshotRow> = {}): AnalyticsSnapshotRow {
  return {
    studentId: 'student-a',
    sessionId: 'session-1',
    totalScore: 70,
    coverage: 0.8,
    suppressed: false,
    excludedForSystemError: false,
    generatedAt: RECENT,
    metrics: {},
    ...overrides,
  };
}

function metrics(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    sessionId: 'session-1',
    occurredAt: RECENT,
    topic: 'fractions',
    subject: 'mathematics',
    mode: 'practice',
    endedWithSystemError: false,
    difficulty: 3,
    difficultySource: 'grade_default',
    firstAttemptQuality: 'meaningful',
    firstAttemptState: 'observed',
    answerSeekingSignals: 0,
    repeatedAnswerSeeking: false,
    highestHintUsed: 1,
    allowedHintLevel: 5,
    hintState: 'observed',
    receivedFullSolution: false,
    accommodationHintLevels: [],
    studentTurnCount: 4,
    reasoningRubric: {
      identifiedMethod: true,
      explainedIntermediateStep: true,
      connectedToConcept: true,
      interpretedResult: true,
      confidence: 1,
      evidenceSpans: [],
    },
    reasoningState: 'observed',
    transfer: {
      issued: true,
      declined: false,
      outcome: 'independent_correct',
      correctnessSource: 'deterministic',
      confidence: 1,
      referenceAnswer: null,
      studentAnswer: null,
    },
    transferState: 'observed',
    verificationRubric: {
      recomputedOrSubstituted: true,
      checkedUnitsOrPlausibility: true,
      statedAssumptionOrLimitation: true,
      correctlyJudgedContent: true,
      confidence: 1,
    },
    verificationState: 'observed',
    ...overrides,
  };
}

function thinMetrics(sessionId: string): SessionMetrics {
  return metrics({
    sessionId,
    firstAttemptQuality: 'meaningful',
    firstAttemptState: 'observed',
    highestHintUsed: null,
    allowedHintLevel: null,
    hintState: 'unavailable',
    reasoningRubric: null,
    reasoningState: 'unavailable',
    transfer: {
      issued: false,
      declined: false,
      outcome: null,
      correctnessSource: 'unavailable',
      confidence: 0,
      referenceAnswer: null,
      studentAnswer: null,
    },
    transferState: 'not_applicable',
    verificationRubric: null,
    verificationState: 'unavailable',
  });
}

function metricsSnapshot(
  sessionMetrics: SessionMetrics,
  studentId = 'student-a',
  overrides: Partial<AnalyticsSnapshotRow> = {},
): AnalyticsSnapshotRow {
  const score = scoreSession(sessionMetrics);
  return {
    studentId,
    sessionId: sessionMetrics.sessionId,
    totalScore: score.rawScore,
    coverage: score.coverage,
    suppressed: score.displaySuppressed,
    excludedForSystemError: score.excludedForSystemError,
    generatedAt: sessionMetrics.occurredAt,
    metrics: sessionMetrics,
    ...overrides,
  };
}

describe('a metric with no observations is never reported as zero', () => {
  it('reports null rather than 0% when no session carried attempt evidence', () => {
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
    });

    expect(result.attemptBeforeHelpRate.value).toBeNull();
    expect(result.attemptBeforeHelpRate.observed).toBe(0);
    expect(result.transferSuccessRate.value).toBeNull();
    expect(result.averageHintLevel.value).toBeNull();
  });

  it('reports the denominator alongside every rate', () => {
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
      sessions: [
        classroomSession(),
        classroomSession({ id: 'session-2' }),
        classroomSession({ id: 'session-3' }),
      ],
      snapshots: [
        snapshot({
          metrics: { firstAttemptState: 'observed', firstAttemptQuality: 'meaningful' },
        }),
        snapshot({
          sessionId: 'session-2',
          metrics: { firstAttemptState: 'observed', firstAttemptQuality: 'none' },
        }),
        // Unavailable evidence lowers coverage; it must not enter the denominator.
        snapshot({ sessionId: 'session-3', metrics: { firstAttemptState: 'unavailable' } }),
      ],
    });

    expect(result.attemptBeforeHelpRate.observed).toBe(2);
    expect(result.attemptBeforeHelpRate.value).toBeCloseTo(0.5);
  });
});

describe('a declined transfer counts against the rate rather than vanishing', () => {
  it('keeps an issued-but-declined transfer in the denominator', () => {
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
      sessions: [classroomSession(), classroomSession({ id: 'session-2' })],
      snapshots: [
        snapshot({
          metrics: {
            transfer: {
              issued: true,
              declined: false,
              outcome: 'independent_correct',
              correctnessSource: 'deterministic',
              confidence: 1,
              referenceAnswer: null,
              studentAnswer: null,
            },
          },
        }),
        snapshot({
          sessionId: 'session-2',
          metrics: {
            transfer: {
              issued: true,
              declined: true,
              outcome: 'declined',
              correctnessSource: 'unavailable',
              confidence: 0,
              referenceAnswer: null,
              studentAnswer: null,
            },
          },
        }),
      ],
    });

    // Were the declined task excluded, this would read 100%: skipping the task
    // would beat attempting it, which is section 56.1's measured defect 1.
    expect(result.transferSuccessRate.observed).toBe(2);
    expect(result.transferSuccessRate.value).toBeCloseTo(0.5);
  });
});

describe('classroom session scope bounds every evidence type', () => {
  it('ignores evidence belonging to a student who is not a member', () => {
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
      sessions: [
        classroomSession({ id: 's1' }),
        classroomSession({ id: 's2', studentId: 'stranger' }),
      ],
      snapshots: [
        snapshot({
          studentId: 'stranger',
          sessionId: 's2',
          totalScore: 100,
          metrics: { hintState: 'observed', highestHintUsed: 0 },
        }),
      ],
    });

    expect(result.sessionsCompletedTotal).toBe(1);
    expect(result.averageHintLevel.value).toBeNull();
    expect(result.independenceAverage.value).toBeNull();
    expect(result.roster).toHaveLength(1);
    expect(result.roster[0].studentId).toBe('student-a');
  });

  it('excludes another classroom, standalone practice, legacy, and unknown sessions for the same student', () => {
    const classroomA = metrics({
      sessionId: 'session-a',
      topic: 'fractions',
      highestHintUsed: 2,
    });
    const classroomB = metrics({
      sessionId: 'session-b',
      topic: 'geometry',
      highestHintUsed: 7,
      transfer: {
        issued: true,
        declined: false,
        outcome: 'attempted_incorrect',
        correctnessSource: 'evaluator',
        confidence: 0.7,
        referenceAnswer: null,
        studentAnswer: null,
      },
    });
    const standalone = metrics({
      sessionId: 'session-c',
      topic: 'private-practice',
      highestHintUsed: 0,
    });
    const legacy = metrics({
      sessionId: 'session-legacy',
      topic: 'legacy-topic',
      highestHintUsed: 6,
    });
    const unknown = metrics({
      sessionId: 'session-unknown',
      topic: 'unknown-topic',
      highestHintUsed: 7,
    });

    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
      sessions: [
        classroomSession({ id: 'session-a' }),
        classroomSession({ id: 'session-b', classroomId: 'class-2', topic: 'geometry' }),
        classroomSession({
          id: 'session-c',
          scope: 'standalone',
          classroomId: null,
          topic: 'private-practice',
        }),
        classroomSession({
          id: 'session-legacy',
          scope: undefined,
          classroomId: undefined,
          topic: 'legacy-topic',
        }),
      ],
      snapshots: [
        metricsSnapshot(classroomA),
        metricsSnapshot(classroomB),
        metricsSnapshot(standalone),
        metricsSnapshot(legacy),
        metricsSnapshot(unknown),
      ],
      attempts: [
        { sessionId: 'session-a', studentId: 'student-a', errorCategory: 'algebra_error' },
        { sessionId: 'session-b', studentId: 'student-a', errorCategory: 'concept_error' },
        { sessionId: 'session-c', studentId: 'student-a', errorCategory: 'private_error' },
        { sessionId: 'session-legacy', studentId: 'student-a', errorCategory: 'legacy_error' },
        { sessionId: 'session-unknown', studentId: 'student-a', errorCategory: 'unknown_error' },
      ],
      reports: [
        { sessionId: 'session-a', studentId: 'student-a', createdAt: RECENT, resolved: false },
        { sessionId: 'session-b', studentId: 'student-a', createdAt: RECENT, resolved: false },
        { sessionId: 'session-c', studentId: 'student-a', createdAt: RECENT, resolved: false },
        {
          sessionId: 'session-legacy',
          studentId: 'student-a',
          createdAt: RECENT,
          resolved: false,
        },
        {
          sessionId: 'session-unknown',
          studentId: 'student-a',
          createdAt: RECENT,
          resolved: false,
        },
      ],
    });

    const expectedProfile = computeIndependenceProfile([classroomA]);
    expect(result.sessionsCompletedTotal).toBe(1);
    expect(result.averageHintLevel.value).toBe(2);
    expect(result.transferSuccessRate.value).toBe(1);
    expect(result.independenceAverage.value).toBe(expectedProfile.score);
    expect(result.roster[0].score).toBe(expectedProfile.score);
    expect(result.topicMastery.map((cell) => cell.topic)).toEqual(['fractions']);
    expect(result.commonErrorCategories).toEqual([{ category: 'algebra_error', count: 1 }]);
    expect(result.openReportCount).toBe(1);
    expect(result.totalReportCount).toBe(1);
  });

  it('rejects a snapshot whose embedded metrics belong to another session', () => {
    const foreign = metrics({
      sessionId: 'session-b',
      topic: 'private-topic',
      highestHintUsed: 7,
      transfer: {
        issued: true,
        declined: false,
        outcome: 'attempted_incorrect',
        correctnessSource: 'evaluator',
        confidence: 0.7,
        referenceAnswer: null,
        studentAnswer: null,
      },
    });
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
      sessions: [classroomSession({ id: 'session-a' })],
      snapshots: [
        metricsSnapshot(foreign, 'student-a', {
          sessionId: 'session-a',
          totalScore: 5,
        }),
      ],
    });

    expect(result.averageHintLevel.value).toBeNull();
    expect(result.transferSuccessRate.value).toBeNull();
    expect(result.independenceTrend).toEqual([]);
    expect(result.topicMastery).toEqual([]);
    expect(result.roster[0].score).toBeNull();
  });
});

describe('a session excluded for a system error is excluded from the aggregate', () => {
  it('drops it rather than scoring the student for a failure of ours', () => {
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
      sessions: [classroomSession()],
      snapshots: [
        snapshot({
          excludedForSystemError: true,
          metrics: { hintState: 'observed', highestHintUsed: 7 },
        }),
      ],
    });

    expect(result.averageHintLevel.value).toBeNull();
  });
});

describe('suppression carries through to the teacher view', () => {
  it('withholds a classroom-scoped profile score built from thin evidence', () => {
    const thin = thinMetrics('session-1');
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
      sessions: [classroomSession()],
      snapshots: [metricsSnapshot(thin)],
    });

    expect(computeIndependenceProfile([thin]).suppressed).toBe(true);
    expect(result.roster[0].score).toBeNull();
    expect(result.roster[0].band).toBeNull();
    expect(result.roster[0].suppressed).toBe(true);
  });

  it('excludes a suppressed classroom profile from the classroom average', () => {
    const observed = metrics({ sessionId: 'session-a', highestHintUsed: 0 });
    const thin = thinMetrics('session-b');
    const expected = computeIndependenceProfile([observed]);

    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [
        { studentId: 'student-a', displayName: 'A' },
        { studentId: 'student-b', displayName: 'B' },
      ],
      sessions: [
        classroomSession({ id: 'session-a' }),
        classroomSession({ id: 'session-b', studentId: 'student-b' }),
      ],
      snapshots: [metricsSnapshot(observed), metricsSnapshot(thin, 'student-b')],
    });

    expect(expected.suppressed).toBe(false);
    expect(result.independenceAverage.value).toBe(expected.score);
    expect(result.independenceAverage.observed).toBe(1);
    expect(result.roster.find((row) => row.studentId === 'student-b')?.score).toBeNull();
  });
});

describe('the activity window is seven days', () => {
  it('counts only students active in the last week', () => {
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [
        { studentId: 'student-a', displayName: 'A' },
        { studentId: 'student-b', displayName: 'B' },
      ],
      sessions: [
        classroomSession({ id: 's1', studentId: 'student-a' }),
        classroomSession({
          id: 's2',
          studentId: 'student-b',
          startedAt: OLD,
          completedAt: OLD,
        }),
      ],
    });

    expect(result.activeStudentsThisWeek).toBe(1);
    expect(result.sessionsCompletedThisWeek).toBe(1);
    expect(result.sessionsCompletedTotal).toBe(2);
  });
});

describe('section 12.7 wording constraints', () => {
  it('emits only the four approved phrasings', () => {
    const approved = Object.values(STUDENT_FLAGS);
    expect(approved).toHaveLength(4);

    const forbidden = /\b(lazy|weak|dishonest|dependent|cheat)\b/i;
    for (const phrase of approved) {
      expect(phrase).not.toMatch(forbidden);
    }
  });

  it('describes high hint use without labelling the student', () => {
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
      sessions: [classroomSession(), classroomSession({ id: 'session-2' })],
      snapshots: [
        snapshot({ metrics: { hintState: 'observed', highestHintUsed: 6 } }),
        snapshot({ sessionId: 'session-2', metrics: { hintState: 'observed', highestHintUsed: 7 } }),
      ],
    });

    expect(result.roster[0].flags).toContain(STUDENT_FLAGS.frequentHighLevelHints);
    for (const flag of result.roster[0].flags) {
      expect(flag).not.toMatch(/\b(lazy|weak|dishonest|dependent)\b/i);
    }
  });

  it('does not flag a student on a single transfer observation', () => {
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
      sessions: [classroomSession()],
      snapshots: [
        snapshot({
          metrics: {
            transfer: {
              issued: true,
              declined: false,
              outcome: 'attempted_incorrect',
              correctnessSource: 'evaluator',
              confidence: 0.7,
              referenceAnswer: null,
              studentAnswer: null,
            },
          },
        }),
      ],
    });

    expect(result.roster[0].flags).not.toContain(STUDENT_FLAGS.transferBelowGuided);
  });
});

describe('topic mastery', () => {
  it('recomputes mastery only from classroom-scoped session metrics', () => {
    const guided = metrics({
      sessionId: 'fractions-guided',
      topic: 'fractions',
      highestHintUsed: 1,
    });
    const weakIndependent = metrics({
      sessionId: 'fractions-independent',
      topic: 'fractions',
      firstAttemptQuality: 'none',
      answerSeekingSignals: 2,
      repeatedAnswerSeeking: true,
      highestHintUsed: 0,
      reasoningRubric: {
        identifiedMethod: false,
        explainedIntermediateStep: false,
        connectedToConcept: false,
        interpretedResult: false,
        confidence: 1,
        evidenceSpans: [],
      },
      transfer: {
        issued: true,
        declined: false,
        outcome: 'attempted_incorrect',
        correctnessSource: 'deterministic',
        confidence: 1,
        referenceAnswer: null,
        studentAnswer: null,
      },
      verificationRubric: {
        recomputedOrSubstituted: false,
        checkedUnitsOrPlausibility: false,
        statedAssumptionOrLimitation: false,
        correctlyJudgedContent: false,
        confidence: 1,
      },
    });
    const linearIndependent = metrics({
      sessionId: 'linear-independent',
      topic: 'linear-equations',
      highestHintUsed: 0,
    });
    const expectedRows = deriveMasteryRows('student-a', [
      guided,
      weakIndependent,
      linearIndependent,
    ]);
    const expectedGap =
      expectedRows.reduce(
        (sum, row) => sum + row.guidedAccuracy - row.independentAccuracy,
        0,
      ) / expectedRows.length;

    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
      sessions: [
        classroomSession({ id: guided.sessionId, topic: guided.topic }),
        classroomSession({ id: weakIndependent.sessionId, topic: weakIndependent.topic }),
        classroomSession({ id: linearIndependent.sessionId, topic: linearIndependent.topic }),
      ],
      snapshots: [
        metricsSnapshot(guided),
        metricsSnapshot(weakIndependent),
        metricsSnapshot(linearIndependent),
      ],
    });

    const fractions = result.topicMastery.find((cell) => cell.topic === 'fractions');
    const linear = result.topicMastery.find((cell) => cell.topic === 'linear-equations');
    expect(fractions?.guidedAccuracy).toBeGreaterThan(fractions?.independentAccuracy ?? 1);
    expect(fractions?.gap).toBeGreaterThanOrEqual(0.25);
    expect(fractions?.sessionCount).toBe(2);
    expect(result.topicsNeedingReview.map((cell) => cell.topic)).toContain('fractions');
    expect(linear?.needsReview).toBe(false);
    expect(result.guidedIndependentGap.value).toBeCloseTo(expectedGap);
  });
});

describe('hint level distribution', () => {
  it('covers every rung of the ladder so an empty rung is visibly zero', () => {
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
      sessions: [classroomSession()],
      snapshots: [snapshot({ metrics: { hintState: 'observed', highestHintUsed: 3 } })],
    });

    expect(result.hintLevelDistribution).toHaveLength(8);
    expect(result.hintLevelDistribution[3].sessions).toBe(1);
    expect(result.hintLevelDistribution[0].sessions).toBe(0);
  });
});

describe('reports', () => {
  it('counts only classroom-scoped reports and separates open from resolved', () => {
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
      sessions: [classroomSession(), classroomSession({ id: 'session-2' })],
      reports: [
        { sessionId: 'session-1', studentId: 'student-a', createdAt: RECENT, resolved: false },
        { sessionId: 'session-2', studentId: 'student-a', createdAt: RECENT, resolved: true },
        { sessionId: 'session-1', studentId: 'stranger', createdAt: RECENT, resolved: false },
        { sessionId: 'unscoped', studentId: 'student-a', createdAt: RECENT, resolved: false },
      ],
    });

    expect(result.openReportCount).toBe(1);
    expect(result.totalReportCount).toBe(2);
  });
});
