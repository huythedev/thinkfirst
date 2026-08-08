import { describe, expect, it } from 'vitest';
import {
  COMPONENT_WEIGHTS,
  MAX_SINGLE_SESSION_MOVEMENT,
  computeIndependenceProfile,
  mayDisplayScore,
  scoreSession,
} from '@/lib/scoring/independence';
import { SessionMetrics } from '@/lib/types/scoring';

/**
 * The twelve tests section 56.6 requires, in its order, each labelled with the
 * measured defect from §56.1 that it exists to prevent.
 *
 * These are not illustrative. Section 49's Phase 5 exit criteria name this suite
 * explicitly: "All twelve tests in 56.6 exist and pass."
 */

function metrics(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    sessionId: 'session-1',
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    topic: 'quadratics',
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
      evidenceSpans: ['because the discriminant is positive'],
    },
    reasoningState: 'observed',
    transfer: {
      issued: true,
      declined: false,
      outcome: 'independent_correct',
      correctnessSource: 'deterministic',
      confidence: 1,
      referenceAnswer: 'x = 3',
      studentAnswer: 'x = 3',
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

/** A session with nothing but a first attempt: the shape §56.1 measured at 100. */
function thinSession(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return metrics({
    firstAttemptQuality: 'meaningful',
    firstAttemptState: 'observed',
    hintState: 'not_applicable',
    highestHintUsed: null,
    allowedHintLevel: null,
    reasoningState: 'not_applicable',
    reasoningRubric: null,
    transferState: 'not_applicable',
    transfer: {
      issued: false,
      declined: false,
      outcome: null,
      correctnessSource: 'unavailable',
      confidence: 0,
      referenceAnswer: null,
      studentAnswer: null,
    },
    verificationState: 'not_applicable',
    verificationRubric: null,
    ...overrides,
  });
}

describe('56.6.1 skipping a transfer task never outscores attempting it', () => {
  it('declining scores strictly below partial success', () => {
    const declined = scoreSession(
      metrics({
        transferState: 'declined',
        transfer: {
          issued: true,
          declined: true,
          outcome: 'declined',
          correctnessSource: 'unavailable',
          confidence: 1,
          referenceAnswer: null,
          studentAnswer: null,
        },
      }),
    );

    const partial = scoreSession(
      metrics({
        transfer: {
          issued: true,
          declined: false,
          outcome: 'partial',
          correctnessSource: 'deterministic',
          confidence: 1,
          referenceAnswer: 'x = 3',
          studentAnswer: 'x = 2.9',
        },
      }),
    );

    expect(declined.rawScore).not.toBeNull();
    expect(partial.rawScore).not.toBeNull();
    expect(declined.rawScore!).toBeLessThan(partial.rawScore!);
  });

  it('declining is scored rather than excluded, so it cannot be dodged', () => {
    const declined = scoreSession(
      metrics({
        transferState: 'declined',
        transfer: {
          issued: true,
          declined: true,
          outcome: 'declined',
          correctnessSource: 'unavailable',
          confidence: 1,
          referenceAnswer: null,
          studentAnswer: null,
        },
      }),
    );

    const component = declined.components.find((entry) => entry.id === 'transferPerformance')!;
    expect(component.state).toBe('declined');
    expect(component.value).not.toBeNull();
    expect(component.confidence).toBeGreaterThan(0);
  });
});

describe('56.6.2 a single thin session is suppressed and shows no band', () => {
  it('returns no score and no band', () => {
    const profile = computeIndependenceProfile([thinSession()]);

    expect(profile.suppressed).toBe(true);
    expect(profile.score).toBeNull();
    expect(profile.band).toBeNull();
    expect(profile.trend).toBeNull();
    expect(profile.suppressionReason).toBe('Not enough practice yet to estimate this.');
  });

  it('still exposes the component breakdown, which §56.4 requires be shown instead', () => {
    const profile = computeIndependenceProfile([thinSession()]);
    expect(profile.components).toHaveLength(5);
    expect(profile.components.find((entry) => entry.id === 'firstAttempt')!.value).not.toBeNull();
  });
});

describe('56.6.3 a transcript with no recorded hint levels is unavailable, not perfect', () => {
  it('marks the component unavailable and reduces coverage', () => {
    const withHints = scoreSession(metrics());
    const withoutHints = scoreSession(metrics({ hintState: 'unavailable', highestHintUsed: null }));

    const component = withoutHints.components.find((entry) => entry.id === 'hintEfficiency')!;
    expect(component.state).toBe('unavailable');
    expect(component.value).toBeNull();
    expect(component.confidence).toBe(0);

    // Coverage falls by the component's full weight, so the missing telemetry is
    // visible rather than absorbed into a confident score.
    expect(withoutHints.coverage).toBeLessThan(withHints.coverage);
    expect(withHints.coverage - withoutHints.coverage).toBeCloseTo(
      COMPONENT_WEIGHTS.hintEfficiency / 100,
      4,
    );
  });

  it('surfaces the instrumentation-health rate the §36 amendment requires', () => {
    const profile = computeIndependenceProfile([
      metrics({ hintState: 'unavailable', highestHintUsed: null }),
    ]);
    expect(profile.instrumentationUnavailableRate).toBeGreaterThan(0);
  });
});

describe('56.6.4 solving with zero hints is excellent, not unmeasured', () => {
  it('scores 1.0 with full confidence and is observed', () => {
    const score = scoreSession(metrics({ highestHintUsed: 0, allowedHintLevel: 5, difficulty: 2 }));
    const component = score.components.find((entry) => entry.id === 'hintEfficiency')!;

    expect(component.state).toBe('observed');
    expect(component.confidence).toBe(1);
    expect(component.value).toBe(1);
  });

  it('rewards zero hints more when a higher ceiling was available', () => {
    const highCeiling = scoreSession(metrics({ highestHintUsed: 1, allowedHintLevel: 5 }));
    const lowCeiling = scoreSession(metrics({ highestHintUsed: 1, allowedHintLevel: 1 }));

    const valueOf = (score: ReturnType<typeof scoreSession>) =>
      score.components.find((entry) => entry.id === 'hintEfficiency')!.value!;

    expect(valueOf(highCeiling)).toBeGreaterThan(valueOf(lowCeiling));
  });
});

describe('56.6.5 reasoning discriminates above half participation', () => {
  it('meeting 4 of 4 criteria scores strictly higher than 2 of 4', () => {
    const all = scoreSession(metrics());
    const half = scoreSession(
      metrics({
        reasoningRubric: {
          identifiedMethod: true,
          explainedIntermediateStep: true,
          connectedToConcept: false,
          interpretedResult: false,
          confidence: 1,
          evidenceSpans: [],
        },
      }),
    );

    const valueOf = (score: ReturnType<typeof scoreSession>) =>
      score.components.find((entry) => entry.id === 'reasoningExplanation')!.value!;

    expect(valueOf(all)).toBe(1);
    expect(valueOf(half)).toBe(0.5);
    expect(valueOf(all)).toBeGreaterThan(valueOf(half));
  });
});

describe('56.6.6 a fluent but incorrect transfer answer scores below a correct one', () => {
  it('scores strictly lower even when the attempt looked meaningful', () => {
    const correct = scoreSession(metrics());
    const fluentWrong = scoreSession(
      metrics({
        transfer: {
          issued: true,
          declined: false,
          outcome: 'attempted_incorrect',
          correctnessSource: 'deterministic',
          confidence: 1,
          referenceAnswer: 'x = 3',
          studentAnswer: 'x = 12',
        },
      }),
    );

    expect(fluentWrong.rawScore!).toBeLessThan(correct.rawScore!);
  });

  it('refuses to grade at all when correctness was never established', () => {
    const score = scoreSession(
      metrics({
        transferState: 'unavailable',
        transfer: {
          issued: true,
          declined: false,
          outcome: null,
          correctnessSource: 'unavailable',
          confidence: 0,
          referenceAnswer: null,
          studentAnswer: null,
        },
      }),
    );

    const component = score.components.find((entry) => entry.id === 'transferPerformance')!;
    expect(component.state).toBe('unavailable');
    expect(component.value).toBeNull();
  });

  it('caps evaluator-established correctness at confidence 0.7', () => {
    const score = scoreSession(
      metrics({
        transfer: {
          issued: true,
          declined: false,
          outcome: 'independent_correct',
          correctnessSource: 'evaluator',
          confidence: 1,
          referenceAnswer: null,
          studentAnswer: 'x = 3',
        },
      }),
    );

    const component = score.components.find((entry) => entry.id === 'transferPerformance')!;
    expect(component.confidence).toBe(0.7);
  });
});

describe('56.6.7 identical behavior at difficulty 1 and 5 scores differently', () => {
  it('changes hint efficiency and transfer, and nothing else', () => {
    const easy = scoreSession(metrics({ difficulty: 1, highestHintUsed: 3, allowedHintLevel: 5 }));
    const hard = scoreSession(metrics({ difficulty: 5, highestHintUsed: 3, allowedHintLevel: 5 }));

    const valueOf = (score: ReturnType<typeof scoreSession>, id: string) =>
      score.components.find((entry) => entry.id === id)!.value;

    expect(valueOf(hard, 'hintEfficiency')).toBeGreaterThan(valueOf(easy, 'hintEfficiency')!);
    expect(valueOf(hard, 'transferPerformance')).not.toBe(valueOf(easy, 'transferPerformance'));

    // §56.3 forbids applying difficulty to these three.
    expect(valueOf(hard, 'firstAttempt')).toBe(valueOf(easy, 'firstAttempt'));
    expect(valueOf(hard, 'reasoningExplanation')).toBe(valueOf(easy, 'reasoningExplanation'));
    expect(valueOf(hard, 'verificationBehavior')).toBe(valueOf(easy, 'verificationBehavior'));
  });
});

describe('56.6.8 hint level 0 scores strictly higher than level 2 at the same ceiling', () => {
  it('does not collapse distinct behaviors to one value', () => {
    const valueOf = (level: number) =>
      scoreSession(metrics({ highestHintUsed: level, allowedHintLevel: 5 })).components.find(
        (entry) => entry.id === 'hintEfficiency',
      )!.value!;

    expect(valueOf(0)).toBeGreaterThan(valueOf(2));
    expect(valueOf(1)).toBeGreaterThan(valueOf(2));
  });
});

describe('56.6.9 component weights sum to 100', () => {
  it('sums to 100', () => {
    const total = Object.values(COMPONENT_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBe(100);
  });
});

describe('56.6.10 no single session moves the profile score by more than 8 points', () => {
  it('clamps a large jump to the §56.4 limit', () => {
    const history = [1, 2, 3, 4].map((index) =>
      metrics({
        sessionId: `session-${index}`,
        occurredAt: new Date(`2026-01-0${index}T00:00:00Z`),
      }),
    );

    const previous = 40;
    const profile = computeIndependenceProfile(history, previous);

    expect(profile.score).not.toBeNull();
    expect(Math.abs(profile.score! - previous)).toBeLessThanOrEqual(MAX_SINGLE_SESSION_MOVEMENT);
  });

  it('clamps downward movement too', () => {
    const history = [1, 2, 3, 4].map((index) =>
      metrics({
        sessionId: `session-${index}`,
        occurredAt: new Date(`2026-01-0${index}T00:00:00Z`),
        firstAttemptQuality: 'none',
        highestHintUsed: 7,
        receivedFullSolution: true,
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
          declined: true,
          outcome: 'declined',
          correctnessSource: 'unavailable',
          confidence: 1,
          referenceAnswer: null,
          studentAnswer: null,
        },
        transferState: 'declined',
      }),
    );

    const previous = 90;
    const profile = computeIndependenceProfile(history, previous);
    expect(Math.abs(profile.score! - previous)).toBeLessThanOrEqual(MAX_SINGLE_SESSION_MOVEMENT);
  });
});

describe('56.6.11 a session that failed with a system error is excluded', () => {
  it('is not scored as abandonment', () => {
    const failed = scoreSession(metrics({ endedWithSystemError: true }));

    expect(failed.excludedForSystemError).toBe(true);
    expect(failed.rawScore).toBeNull();
    expect(failed.coverage).toBe(0);
  });

  it('does not drag the profile down', () => {
    const good = [1, 2, 3, 4].map((index) =>
      metrics({
        sessionId: `session-${index}`,
        occurredAt: new Date(`2026-01-0${index}T00:00:00Z`),
      }),
    );

    const withoutFailure = computeIndependenceProfile(good);
    const withFailure = computeIndependenceProfile([
      ...good,
      metrics({
        sessionId: 'failed',
        occurredAt: new Date('2026-01-05T00:00:00Z'),
        endedWithSystemError: true,
        firstAttemptQuality: 'none',
      }),
    ]);

    expect(withFailure.score).toBe(withoutFailure.score);
    expect(withFailure.sessionsExcluded).toBe(1);
  });
});

describe('56.6.12 recomputation from stored metrics is deterministic', () => {
  it('produces identical output for identical input', () => {
    const history = [1, 2, 3, 4].map((index) =>
      metrics({
        sessionId: `session-${index}`,
        occurredAt: new Date(`2026-01-0${index}T00:00:00Z`),
      }),
    );

    const first = computeIndependenceProfile(history);
    const second = computeIndependenceProfile(history);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('does not depend on the order sessions arrive in', () => {
    const history = [1, 2, 3, 4].map((index) =>
      metrics({
        sessionId: `session-${index}`,
        occurredAt: new Date(`2026-01-0${index}T00:00:00Z`),
        highestHintUsed: index,
      }),
    );

    const forward = computeIndependenceProfile(history);
    const reversed = computeIndependenceProfile([...history].reverse());

    expect(reversed.score).toBe(forward.score);
    expect(reversed.evidenceWeight).toBe(forward.evidenceWeight);
  });
});

/**
 * Phase 5's fifth exit criterion: "No score, band or trend is displayed when
 * section 56's suppression rule applies."
 *
 * Both surfaces that render a score call `mayDisplayScore`, so the rule is tested
 * here rather than asserted about JSX. A UI that ignored this would be a defect
 * these tests would not catch, which is why the two components share one gate
 * instead of each writing the condition out.
 */
describe('suppression is honored at the display boundary', () => {
  it('refuses to display a suppressed profile even when a score is present', () => {
    expect(mayDisplayScore({ score: 73, suppressed: true })).toBe(false);
  });

  it('refuses to display a null score even when not suppressed', () => {
    expect(mayDisplayScore({ score: null, suppressed: false })).toBe(false);
  });

  it('refuses to display anything when there is no profile at all', () => {
    expect(mayDisplayScore(null)).toBe(false);
    expect(mayDisplayScore(undefined)).toBe(false);
  });

  it('displays a real score that the server did not suppress', () => {
    expect(mayDisplayScore({ score: 73, suppressed: false })).toBe(true);
  });

  it('agrees with the profile a thin session actually produces', () => {
    const profile = computeIndependenceProfile([thinSession()]);
    expect(mayDisplayScore(profile)).toBe(false);
    // And the band and trend the UI would read are absent, not merely unrendered.
    expect(profile.band).toBeNull();
    expect(profile.trend).toBeNull();
  });

  it('agrees with the profile a well-evidenced history produces', () => {
    const history = [1, 2, 3, 4].map((index) =>
      metrics({
        sessionId: `session-${index}`,
        occurredAt: new Date(`2026-01-0${index}T00:00:00Z`),
      }),
    );
    const profile = computeIndependenceProfile(history);
    expect(mayDisplayScore(profile)).toBe(true);
    expect(profile.band).not.toBeNull();
  });
});
