import { describe, expect, it } from 'vitest';
import {
  COMPONENT_WEIGHTS,
  MIN_EVIDENCE_WEIGHT_TO_DISPLAY,
  NEUTRAL_PRIOR,
  applyDifficulty,
  bandForScore,
  computeIndependenceProfile,
  scoreSession,
} from '@/lib/scoring/independence';
import { SessionMetrics } from '@/lib/types/scoring';

/**
 * Stages 2 to 4 of section 56.
 *
 * The twelve tests §56.6 mandates live in `section-56-required.test.ts`. This file
 * covers the surrounding behavior: band boundaries, difficulty adjustment,
 * coverage arithmetic, shrinkage toward the prior, and trend suppression.
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
      evidenceSpans: [],
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

describe('bandForScore', () => {
  it.each([
    [100, 'increasingly_independent'],
    [80, 'increasingly_independent'],
    [79, 'developing_independence'],
    [60, 'developing_independence'],
    [59, 'benefits_from_guided_support'],
    [40, 'benefits_from_guided_support'],
    [39, 'needs_structured_practice'],
    [0, 'needs_structured_practice'],
  ])('maps %i to %s', (score, expected) => {
    expect(bandForScore(score).id).toBe(expected);
  });

  it('clamps out-of-range input rather than returning undefined', () => {
    expect(bandForScore(140).id).toBe('increasingly_independent');
    expect(bandForScore(-20).id).toBe('needs_structured_practice');
  });
});

describe('applyDifficulty', () => {
  it('is nearly neutral at the midpoint', () => {
    expect(applyDifficulty(1, 3)).toBeCloseTo(1, 5);
    expect(applyDifficulty(0.5, 3)).toBeCloseTo(0.5375, 5);
  });

  it('penalizes needing help on a hard problem less', () => {
    expect(applyDifficulty(0.5, 5)).toBeGreaterThan(applyDifficulty(0.5, 1));
  });

  it('never leaves [0,1]', () => {
    expect(applyDifficulty(1, 5)).toBeLessThanOrEqual(1);
    expect(applyDifficulty(0, 1)).toBe(0);
  });
});

describe('session aggregation', () => {
  it('gives a fully independent session a perfect raw score', () => {
    const score = scoreSession(metrics({ highestHintUsed: 0 }));
    expect(score.rawScore).toBe(100);
    expect(score.coverage).toBe(1);
    expect(score.displaySuppressed).toBe(false);
  });

  it('excludes not_applicable components from coverage', () => {
    const score = scoreSession(
      metrics({
        verificationState: 'not_applicable',
        verificationRubric: null,
      }),
    );

    expect(score.coverage).toBeCloseTo(1 - COMPONENT_WEIGHTS.verificationBehavior / 100, 4);
  });

  it('weights a low-confidence component down without discarding it', () => {
    const confident = scoreSession(metrics());
    const unsure = scoreSession(
      metrics({
        reasoningRubric: {
          identifiedMethod: false,
          explainedIntermediateStep: false,
          connectedToConcept: false,
          interpretedResult: false,
          confidence: 0.25,
          evidenceSpans: [],
        },
      }),
    );

    // A weak but low-confidence signal moves the score less than a weak certain one.
    const certainWeak = scoreSession(
      metrics({
        reasoningRubric: {
          identifiedMethod: false,
          explainedIntermediateStep: false,
          connectedToConcept: false,
          interpretedResult: false,
          confidence: 1,
          evidenceSpans: [],
        },
      }),
    );

    expect(unsure.rawScore!).toBeLessThan(confident.rawScore!);
    expect(unsure.rawScore!).toBeGreaterThan(certainWeak.rawScore!);
    expect(unsure.coverage).toBeLessThan(confident.coverage);
  });

  it('scores lower when the student needed the full solution', () => {
    const independent = scoreSession(metrics({ highestHintUsed: 0 })).rawScore!;
    const guided = scoreSession(
      metrics({ highestHintUsed: 7, allowedHintLevel: 7, receivedFullSolution: true }),
    ).rawScore!;

    expect(guided).toBeLessThan(independent);
  });

  it('does not score an accommodation as dependence', () => {
    const penalized = scoreSession(metrics({ highestHintUsed: 4, accommodationHintLevels: [] }));
    const accommodated = scoreSession(
      metrics({ highestHintUsed: 4, accommodationHintLevels: [4] }),
    );

    expect(accommodated.rawScore!).toBeGreaterThan(penalized.rawScore!);
  });
});

describe('profile aggregation', () => {
  const history = (count: number, overrides: Partial<SessionMetrics> = {}) =>
    Array.from({ length: count }, (_unused, index) =>
      metrics({
        sessionId: `session-${index + 1}`,
        occurredAt: new Date(2026, 0, index + 1),
        ...overrides,
      }),
    );

  it('suppresses everything below the evidence-weight threshold', () => {
    const profile = computeIndependenceProfile([
      metrics({
        hintState: 'not_applicable',
        highestHintUsed: null,
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
      }),
    ]);

    expect(profile.evidenceWeight).toBeLessThan(MIN_EVIDENCE_WEIGHT_TO_DISPLAY);
    expect(profile.score).toBeNull();
    expect(profile.band).toBeNull();
  });

  it('pulls a strong but thin record toward the neutral prior', () => {
    const profile = computeIndependenceProfile(history(2));
    expect(profile.score).not.toBeNull();
    // Every session is perfect, yet the reported score is below 100 because the
    // prior still carries weight. This is the cure for measured defect 2.
    expect(profile.score!).toBeLessThan(100);
    expect(profile.score!).toBeGreaterThan(NEUTRAL_PRIOR);
  });

  it('lets the prior fade as evidence accumulates', () => {
    const thin = computeIndependenceProfile(history(2));
    const thick = computeIndependenceProfile(history(10));
    expect(thick.score!).toBeGreaterThan(thin.score!);
  });

  it('suppresses the trend below four scored sessions', () => {
    expect(computeIndependenceProfile(history(3)).trend).toBeNull();
  });

  it('reports a trend once there are enough sessions and enough coverage', () => {
    const earlier = Array.from({ length: 3 }, (_unused, index) =>
      metrics({
        sessionId: `early-${index}`,
        occurredAt: new Date(2026, 0, index + 1),
        firstAttemptQuality: 'none',
        highestHintUsed: 6,
      }),
    );
    const later = Array.from({ length: 3 }, (_unused, index) =>
      metrics({
        sessionId: `late-${index}`,
        occurredAt: new Date(2026, 1, index + 1),
        highestHintUsed: 0,
      }),
    );

    const profile = computeIndependenceProfile([...earlier, ...later]);
    expect(profile.trend).not.toBeNull();
    expect(profile.trend!).toBeGreaterThan(0);
  });

  it('offers a suggestion aimed at the weakest measured component', () => {
    const profile = computeIndependenceProfile(
      history(4, {
        verificationRubric: {
          recomputedOrSubstituted: false,
          checkedUnitsOrPlausibility: false,
          statedAssumptionOrLimitation: false,
          correctlyJudgedContent: false,
          confidence: 1,
        },
      }),
    );

    expect(profile.suggestion).toContain('substituting it back');
  });

  it('reports zero unavailable rate when everything was instrumented', () => {
    expect(computeIndependenceProfile(history(4)).instrumentationUnavailableRate).toBe(0);
  });
});
