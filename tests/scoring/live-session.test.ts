import { describe, expect, it } from 'vitest';
import { scoreSession } from '@/lib/scoring/independence';
import { RawAttempt, RawSession, RawTurn, deriveSessionMetrics } from '@/lib/scoring/metrics';

/**
 * Stage 1 extraction, exercised over a transcript as it grows.
 *
 * These tests are about *provenance*, not arithmetic. The v1 versions of them
 * asserted `measured: true | false`, which is exactly the two-state model §56.1
 * blames for three of its four severe defects, so they are rewritten around the
 * four states rather than renamed.
 */

const session: RawSession = { id: 'live', mode: 'practice', subject: 'mathematics' };

function tutorTurn(sequence: number, overrides: Partial<RawTurn> = {}): RawTurn {
  return {
    sessionId: 'live',
    sequence,
    actor: 'assistant',
    content: 'tutor',
    tutorMetadata: { hintLevel: 1, responseType: 'question', finalAnswerIncluded: false },
    ...overrides,
  };
}

function studentTurn(sequence: number, content = 'student'): RawTurn {
  return { sessionId: 'live', sequence, actor: 'student', content };
}

const stateOf = (turns: RawTurn[], id: string, attempts: RawAttempt[] = []) =>
  scoreSession(deriveSessionMetrics(session, turns, attempts)).components.find(
    (component) => component.id === id,
  )!.state;

describe('extraction before anything has happened', () => {
  it('reports no coverage and no score', () => {
    const score = scoreSession(deriveSessionMetrics(session, []));
    expect(score.coverage).toBe(0);
    expect(score.rawScore).toBeNull();
    expect(score.displaySuppressed).toBe(true);
  });

  it('marks every component not_applicable rather than unavailable', () => {
    const score = scoreSession(deriveSessionMetrics(session, []));
    for (const component of score.components) {
      expect(component.state).toBe('not_applicable');
    }
  });
});

describe('first attempt provenance', () => {
  it('is unavailable while the student has spoken but nothing has classified it', () => {
    // The distinction that v1 could not express: the student did attempt, and the
    // telemetry has not caught up. Scoring this as "no attempt" is defect 3.
    expect(stateOf([studentTurn(1, 'I think I factor it')], 'firstAttempt')).toBe('unavailable');
  });

  it('becomes observed once the classifier result lands', () => {
    const turns = [
      studentTurn(1, 'I think I factor it'),
      tutorTurn(2, { intentAnalysis: { intent: 'problem_solving', attemptQuality: 'meaningful' } }),
    ];

    expect(stateOf(turns, 'firstAttempt')).toBe('observed');

    const component = scoreSession(deriveSessionMetrics(session, turns)).components.find(
      (entry) => entry.id === 'firstAttempt',
    )!;
    expect(component.value).toBe(1);
    expect(component.confidence).toBe(1);
  });
});

describe('hint provenance', () => {
  it('is not_applicable when the tutor has not answered yet', () => {
    expect(stateOf([studentTurn(1)], 'hintEfficiency')).toBe('not_applicable');
  });

  it('is unavailable when the tutor answered without recording a level', () => {
    const turns = [
      studentTurn(1),
      tutorTurn(2, { tutorMetadata: { responseType: 'question', finalAnswerIncluded: false } }),
    ];
    expect(stateOf(turns, 'hintEfficiency')).toBe('unavailable');
  });

  it('is observed when a level was recorded', () => {
    expect(stateOf([studentTurn(1), tutorTurn(2)], 'hintEfficiency')).toBe('observed');
  });

  it('reads the ceiling from the response plan the endpoint stored', () => {
    const turns = [
      studentTurn(1),
      tutorTurn(2, { responsePlan: { allowedHintLevel: 5 }, tutorMetadata: { hintLevel: 1 } }),
    ];
    const metrics = deriveSessionMetrics(session, turns);
    expect(metrics.allowedHintLevel).toBe(5);
    expect(metrics.highestHintUsed).toBe(1);
  });
});

describe('transfer provenance', () => {
  const issued = [
    studentTurn(1),
    tutorTurn(2, {
      tutorMetadata: { hintLevel: 5, responseType: 'transfer_problem', finalAnswerIncluded: false },
    }),
  ];

  it('is not_applicable when no transfer problem was offered', () => {
    expect(stateOf([studentTurn(1), tutorTurn(2)], 'transferPerformance')).toBe('not_applicable');
  });

  it('is unavailable while an active session still has time to answer', () => {
    expect(stateOf(issued, 'transferPerformance')).toBe('unavailable');
  });

  it.each(['completed', 'abandoned'] as const)('is declined only after a %s session ends', (status) => {
    expect(
      scoreSession(deriveSessionMetrics({ ...session, status }, issued)).components.find(
        (component) => component.id === 'transferPerformance',
      )!.state,
    ).toBe('declined');
  });

  it('is unavailable when the student replied but correctness was never established', () => {
    const turns = [...issued, studentTurn(3, 'x = 4')];
    expect(stateOf(turns, 'transferPerformance')).toBe('unavailable');
  });

  it('is observed once a stored evaluation establishes correctness', () => {
    const turns = [...issued, studentTurn(3, 'x = 4')];
    const attempts: RawAttempt[] = [
      {
        sessionId: 'live',
        attemptType: 'transfer',
        evaluation: {
          transferOutcome: 'independent_correct',
          correctnessSource: 'deterministic',
          correctnessConfidence: 1,
          referenceAnswer: 'x = 4',
          studentAnswer: 'x = 4',
        },
      },
    ];

    expect(stateOf(turns, 'transferPerformance', attempts)).toBe('observed');
  });
});

describe('reasoning and verification provenance', () => {
  it('reads the stored explanation rubric rather than counting turns', () => {
    const turns = [
      studentTurn(1),
      tutorTurn(2, { responsePlan: { requiresExplanation: true } }),
      studentTurn(3, 'I used the quadratic formula because it does not factor'),
    ];
    const attempts: RawAttempt[] = [
      {
        sessionId: 'live',
        attemptType: 'explanation',
        evaluation: {
          reasoningRubric: {
            identifiedMethod: true,
            explainedIntermediateStep: true,
            connectedToConcept: false,
            interpretedResult: false,
            confidence: 0.8,
            evidenceSpans: ['because it does not factor'],
          },
        },
      },
    ];

    const component = scoreSession(
      deriveSessionMetrics(session, turns, attempts),
    ).components.find((entry) => entry.id === 'reasoningExplanation')!;

    expect(component.state).toBe('observed');
    expect(component.value).toBe(0.5);
    expect(component.confidence).toBe(0.8);
  });

  it('marks reasoning declined when an explanation was asked for and never given', () => {
    const turns = [
      studentTurn(1),
      tutorTurn(2, { responsePlan: { requiresExplanation: true } }),
    ];
    expect(stateOf(turns, 'reasoningExplanation')).toBe('declined');
  });

  it('marks verification not_applicable outside verify mode when it never came up', () => {
    expect(stateOf([studentTurn(1), tutorTurn(2)], 'verificationBehavior')).toBe('not_applicable');
  });

  it('marks verification declined in verify mode when the student never replied', () => {
    const verifySession: RawSession = { ...session, mode: 'verify' };
    const score = scoreSession(deriveSessionMetrics(verifySession, [tutorTurn(1)]));
    expect(score.components.find((entry) => entry.id === 'verificationBehavior')!.state).toBe(
      'declined',
    );
  });
});

describe('coverage as the session progresses', () => {
  it('never decreases as evidence accumulates', () => {
    const turns = [
      studentTurn(1),
      tutorTurn(2, {
        intentAnalysis: { intent: 'problem_solving', attemptQuality: 'meaningful' },
        responsePlan: { allowedHintLevel: 3 },
        tutorMetadata: { hintLevel: 1, responseType: 'hint', finalAnswerIncluded: false },
      }),
      studentTurn(3),
      tutorTurn(4, {
        intentAnalysis: { intent: 'step_check', attemptQuality: 'meaningful' },
        responsePlan: { allowedHintLevel: 3 },
        tutorMetadata: { hintLevel: 2, responseType: 'feedback', finalAnswerIncluded: false },
      }),
    ];

    const coverages = [0, 1, 2, 4].map(
      (count) => scoreSession(deriveSessionMetrics(session, turns.slice(0, count))).coverage,
    );

    for (let index = 1; index < coverages.length; index += 1) {
      expect(coverages[index]).toBeGreaterThanOrEqual(coverages[index - 1]);
    }
  });

  it('keeps an early session below the §56.3 display threshold', () => {
    // One student message must not produce a number. §56.3 records the session and
    // suppresses the display below 0.35 coverage.
    const score = scoreSession(deriveSessionMetrics(session, [studentTurn(1)]));
    expect(score.coverage).toBeLessThan(0.35);
    expect(score.displaySuppressed).toBe(true);
  });
});

describe('system error extraction', () => {
  it('picks up the flag the endpoint writes on the session', () => {
    const failed: RawSession = { ...session, endedWithSystemError: true };
    const score = scoreSession(deriveSessionMetrics(failed, [studentTurn(1), tutorTurn(2)]));
    expect(score.excludedForSystemError).toBe(true);
    expect(score.rawScore).toBeNull();
  });
});
