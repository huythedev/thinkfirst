import { describe, expect, it } from 'vitest';
import {
  STUDENT_FLAGS,
  aggregateClassroomAnalytics,
  type AnalyticsSnapshotRow,
  type ClassroomAnalyticsInput,
} from '@/lib/analytics/classroom';

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
    profiles: [],
    mastery: [],
    attempts: [],
    reports: [],
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
    // would beat attempting it, which is §56.1's measured defect 1.
    expect(result.transferSuccessRate.observed).toBe(2);
    expect(result.transferSuccessRate.value).toBeCloseTo(0.5);
  });
});

describe('cross-student data never enters a classroom aggregate', () => {
  it('ignores evidence belonging to a student who is not a member', () => {
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
      sessions: [
        {
          id: 's1',
          studentId: 'student-a',
          status: 'completed',
          startedAt: RECENT,
          completedAt: RECENT,
        },
        {
          id: 's2',
          studentId: 'stranger',
          status: 'completed',
          startedAt: RECENT,
          completedAt: RECENT,
        },
      ],
      snapshots: [
        snapshot({ studentId: 'stranger', totalScore: 100, metrics: { hintState: 'observed', highestHintUsed: 0 } }),
      ],
      profiles: [
        { studentId: 'stranger', score: 99, band: 'increasingly_independent', trend: 5, suppressed: false, coverage: 1 },
      ],
    });

    expect(result.sessionsCompletedTotal).toBe(1);
    expect(result.averageHintLevel.value).toBeNull();
    expect(result.independenceAverage.value).toBeNull();
    expect(result.roster).toHaveLength(1);
    expect(result.roster[0].studentId).toBe('student-a');
  });
});

describe('a session excluded for a system error is excluded from the aggregate', () => {
  it('drops it rather than scoring the student for a failure of ours', () => {
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
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
  it('withholds a suppressed profile score from the roster', () => {
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
      profiles: [
        {
          studentId: 'student-a',
          score: 64,
          band: 'developing_independence',
          trend: 3,
          suppressed: true,
          coverage: 0.2,
        },
      ],
    });

    // A number the student is not shown must not appear on a teacher's screen
    // either: it is the same unreliable figure, and §56.4 suppresses it because
    // it is not trustworthy, not because of who is looking.
    expect(result.roster[0].score).toBeNull();
    expect(result.roster[0].band).toBeNull();
    expect(result.roster[0].suppressed).toBe(true);
  });

  it('excludes a suppressed profile from the classroom average', () => {
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [
        { studentId: 'student-a', displayName: 'A' },
        { studentId: 'student-b', displayName: 'B' },
      ],
      profiles: [
        { studentId: 'student-a', score: 80, band: null, trend: null, suppressed: false, coverage: 1 },
        { studentId: 'student-b', score: 20, band: null, trend: null, suppressed: true, coverage: 0.1 },
      ],
    });

    expect(result.independenceAverage.value).toBe(80);
    expect(result.independenceAverage.observed).toBe(1);
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
        { id: 's1', studentId: 'student-a', status: 'completed', startedAt: RECENT, completedAt: RECENT },
        { id: 's2', studentId: 'student-b', status: 'completed', startedAt: OLD, completedAt: OLD },
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
  it('flags a topic where independent work trails guided work', () => {
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
      mastery: [
        {
          studentId: 'student-a',
          subject: 'mathematics',
          topic: 'fractions',
          guidedAccuracy: 0.9,
          independentAccuracy: 0.5,
          averageHintLevel: 4,
          transferSuccessRate: 0.4,
          sessionCount: 3,
        },
        {
          studentId: 'student-a',
          subject: 'mathematics',
          topic: 'linear-equations',
          guidedAccuracy: 0.8,
          independentAccuracy: 0.78,
          averageHintLevel: 2,
          transferSuccessRate: 0.9,
          sessionCount: 4,
        },
      ],
    });

    expect(result.topicsNeedingReview.map((cell) => cell.topic)).toEqual(['fractions']);
    expect(result.guidedIndependentGap.value).toBeCloseTo((0.4 + 0.02) / 2);
  });
});

describe('hint level distribution', () => {
  it('covers every rung of the ladder so an empty rung is visibly zero', () => {
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
      snapshots: [snapshot({ metrics: { hintState: 'observed', highestHintUsed: 3 } })],
    });

    expect(result.hintLevelDistribution).toHaveLength(8);
    expect(result.hintLevelDistribution[3].sessions).toBe(1);
    expect(result.hintLevelDistribution[0].sessions).toBe(0);
  });
});

describe('reports', () => {
  it('counts open reports separately from resolved ones', () => {
    const result = aggregateClassroomAnalytics('class-1', {
      ...emptyInput(),
      members: [{ studentId: 'student-a', displayName: 'A' }],
      reports: [
        { studentId: 'student-a', createdAt: RECENT, resolved: false },
        { studentId: 'student-a', createdAt: RECENT, resolved: true },
        { studentId: 'stranger', createdAt: RECENT, resolved: false },
      ],
    });

    expect(result.openReportCount).toBe(1);
    expect(result.totalReportCount).toBe(2);
  });
});
