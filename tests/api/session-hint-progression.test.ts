import { describe, expect, it } from 'vitest';
import { generateResponsePlan } from '@/services/ai-gateway/src/policy';
import { clampToLadder, nextHintLevel } from '@/lib/session/hint-ladder';
import { effectiveHintLevelAfterDelivery } from '@/lib/session/delivered-hint';
import { MAX_HINT_LEVEL } from '@/lib/types/ai/request';
import type { IntentAnalysis } from '@/lib/types/ai/schema';

/**
 * Phase 3 asks that the mode and hint indicators reflect *server* state. The
 * pure-function tests in `hint-ladder.test.ts` prove each piece in isolation;
 * these exercise the composition the tutoring endpoint actually performs, which
 * is where a regression would hide:
 *
 *   stored level -> generateResponsePlan -> nextHintLevel -> persisted
 *
 * The endpoint itself is not imported because it makes two live model calls. The
 * functions below are the whole of its hint-ladder decision, so driving them in
 * the same order reproduces it without a network dependency or quota.
 *
 * Updated in session 08: the claimed-level and claimed-strictness parameters are
 * kept because they document what a hostile client *would* have sent, but they no
 * longer reach the decision at all, since the request contract rejects them. The
 * tests below assert exactly that.
 */

function intent(overrides: Partial<IntentAnalysis> = {}): IntentAnalysis {
  return {
    intent: 'answer_request',
    subject: 'mathematics',
    topic: 'linear equations',
    estimatedGradeLevel: 8,
    problemStatement: 'Solve for x: 3x + 7 = 22',
    studentProvidedAttempt: false,
    attemptQuality: 'none',
    answerSeekingLikelihood: 0.9,
    ambiguityLevel: 'low',
    missingInformation: [],
    detectedLanguage: 'en',
    safetyCategory: 'none',
    confidence: 0.9,
    ...overrides,
  } as IntentAnalysis;
}

/** One turn of the endpoint's hint-ladder decision. */
function runTurn({
  storedLevel,
  claimedLevel = MAX_HINT_LEVEL,
  claimedStrictness = 'supportive',
  storedStrictness = 'balanced',
  storedMode = 'practice',
  assistantTurns = 0,
  intentData = intent(),
}: {
  storedLevel: number | null;
  claimedLevel?: number;
  claimedStrictness?: 'supportive' | 'balanced' | 'independence' | 'assessment_safe';
  storedStrictness?: 'supportive' | 'balanced' | 'independence' | 'assessment_safe';
  storedMode?: 'learn' | 'practice' | 'assignment' | 'verify';
  assistantTurns?: number;
  intentData?: IntentAnalysis;
}) {
  const hasSession = storedLevel !== null;

  // Mirrors the endpoint: when a session was read, stored values win outright and
  // the claimed ones are discarded rather than merged.
  const effectiveStrictness = hasSession
    ? storedStrictness
    : claimedStrictness === 'supportive'
      ? 'balanced'
      : claimedStrictness;

  // The endpoint reads the level from the session document and nowhere else. The
  // claimed level is deliberately unused: it is here to show that varying it
  // changes nothing.
  void claimedLevel;
  void assistantTurns;
  const effectiveHintLevel = clampToLadder(storedLevel ?? 0);

  const plan = generateResponsePlan(intentData, {
    mode: storedMode,
    strictness: effectiveStrictness,
    currentHintLevel: effectiveHintLevel,
    hasReceivedFullSolution: effectiveHintLevel >= MAX_HINT_LEVEL,
  });

  return {
    plan,
    effectiveStrictness,
    effectiveHintLevel,
    persistedHintLevel: nextHintLevel(effectiveHintLevel, plan.allowedHintLevel),
  };
}

describe('hint ladder progression through the policy engine', () => {
  it('does not consume a rung when semantic enforcement withholds model prose', () => {
    const plan = generateResponsePlan(intent({ studentProvidedAttempt: true, attemptQuality: 'partial' }), {
      mode: 'practice', strictness: 'balanced', currentHintLevel: 0, hasReceivedFullSolution: false,
    });
    const delivered = {
      messageMarkdown: 'I held that back.', responseType: 'question' as const, hintLevel: 0 as const,
      finalAnswerIncluded: false, studentActionRequired: null, checkForUnderstanding: null,
      confidenceStatement: null, learningObjective: null, internalConceptTags: [],
    };
    expect(effectiveHintLevelAfterDelivery({
      previousHintLevel: 0, responsePlan: plan, deliveredResponse: delivered, messageWithheld: true,
    })).toBe(0);
  });

  it('refuses to advance until the student has attempted something', () => {
    const result = runTurn({ storedLevel: 0, intentData: intent({ attemptQuality: 'none' }) });

    expect(result.plan.rationaleCode).toBe('ATTEMPT_REQUIRED');
    expect(result.plan.allowedHintLevel).toBe(0);
    expect(result.plan.mayRevealFinalAnswer).toBe(false);
    expect(result.persistedHintLevel).toBe(0);
  });

  it('advances one rung once a real attempt is on the record', () => {
    const result = runTurn({
      storedLevel: 0,
      intentData: intent({ studentProvidedAttempt: true, attemptQuality: 'partial' }),
    });

    expect(result.plan.rationaleCode).toBe('NEXT_HINT_ALLOWED');
    expect(result.plan.allowedHintLevel).toBe(1);
    // This is the value the endpoint writes to the session document, and the only
    // thing the indicator reads.
    expect(result.persistedHintLevel).toBe(1);
  });

  it('climbs one rung per turn rather than jumping, across a whole session', () => {
    const attempted = intent({ studentProvidedAttempt: true, attemptQuality: 'partial' });
    const levels: number[] = [];
    let stored = 0;

    for (let turn = 0; turn < 8; turn += 1) {
      const result = runTurn({ storedLevel: stored, intentData: attempted });
      stored = result.persistedHintLevel;
      levels.push(stored);
    }

    // Levels 1-6 by progression, then level 7 on the turn *after* the ceiling is
    // reached. This changed in session 08: level 7 was previously unreachable,
    // because escalation stopped at 6 and the only route to 7 was a branch that
    // could never fire. That was the audit's P3 ambiguity, resolved as "0-6 by
    // progression, 7 only when disclosure is permitted".
    expect(levels).toEqual([1, 2, 3, 4, 5, 6, 7, 7]);

    // The important invariant is unchanged and is what this test exists for: no
    // single turn advances more than one rung.
    let previous = 0;
    for (const level of levels) {
      expect(level - previous).toBeLessThanOrEqual(1);
      previous = level;
    }
    expect(stored).toBe(MAX_HINT_LEVEL);
  });

  it('cannot reach the full-solution rung when disclosure is forbidden', () => {
    const attempted = intent({ studentProvidedAttempt: true, attemptQuality: 'partial' });
    let stored = 0;

    for (let turn = 0; turn < 10; turn += 1) {
      stored = runTurn({
        storedLevel: stored,
        storedStrictness: 'assessment_safe',
        intentData: attempted,
      }).persistedHintLevel;
    }

    expect(stored).toBeLessThanOrEqual(4);
  });

  it('decides identically whether the client claims level 7 or nothing at all', () => {
    const attempted = intent({ studentProvidedAttempt: true, attemptQuality: 'partial' });

    const hostile = runTurn({
      storedLevel: 3,
      claimedLevel: MAX_HINT_LEVEL,
      claimedStrictness: 'supportive',
      intentData: attempted,
    });
    const honest = runTurn({
      storedLevel: 3,
      claimedLevel: 0,
      claimedStrictness: 'balanced',
      intentData: attempted,
    });

    expect(hostile.plan).toEqual(honest.plan);
    expect(hostile.persistedHintLevel).toBe(honest.persistedHintLevel);
    expect(hostile.effectiveStrictness).toBe('balanced');
  });

  it('ignores a client claim of supportive strictness that would unlock a hint', () => {
    const noAttempt = intent({ attemptQuality: 'none', studentProvidedAttempt: false });

    // `supportive` is the one strictness that grants a hint with no attempt, so a
    // client claiming it is the direct route to a free hint.
    const claimed = runTurn({
      storedLevel: 0,
      claimedStrictness: 'supportive',
      storedStrictness: 'independence',
      intentData: noAttempt,
    });
    expect(claimed.plan.rationaleCode).toBe('ATTEMPT_REQUIRED');
    expect(claimed.plan.allowedHintLevel).toBe(0);

    // The same claim is honoured when it is genuinely the stored value, which is
    // what makes the test above meaningful rather than vacuous.
    const stored = runTurn({
      storedLevel: 0,
      storedStrictness: 'supportive',
      intentData: noAttempt,
    });
    expect(stored.plan.rationaleCode).toBe('NEXT_HINT_ALLOWED');
    expect(stored.plan.allowedHintLevel).toBe(1);
  });

  it('holds assessment_safe sessions below the disclosure rungs', () => {
    const result = runTurn({
      storedLevel: 4,
      storedStrictness: 'assessment_safe',
      claimedStrictness: 'supportive',
      intentData: intent({ studentProvidedAttempt: true, attemptQuality: 'meaningful' }),
    });

    expect(result.plan.mayRevealFinalAnswer).toBe(false);
    expect(result.plan.allowedHintLevel).toBeLessThanOrEqual(4);
    expect(result.persistedHintLevel).toBeLessThanOrEqual(4);
  });

  it('uses the stored mode, so the indicator cannot be driven from the body', () => {
    // `learn` is the permissive mode: it grants a hint with no attempt at all.
    const result = runTurn({
      storedLevel: 0,
      storedMode: 'assignment',
      intentData: intent({ attemptQuality: 'none' }),
    });

    expect(result.plan.rationaleCode).toBe('ATTEMPT_REQUIRED');
    expect(result.plan.allowedHintLevel).toBe(0);
  });

  it('never lowers a level the student has already been given', () => {
    const result = runTurn({
      storedLevel: 5,
      intentData: intent({ attemptQuality: 'none', studentProvidedAttempt: false }),
    });

    // The plan drops to 0 because no attempt was made, but the persisted level
    // holds at 5: help already received stays visible to scoring and teachers.
    expect(result.plan.allowedHintLevel).toBe(0);
    expect(result.persistedHintLevel).toBe(5);
  });

  it('a safety classification pins the ladder regardless of stored position', () => {
    const result = runTurn({
      storedLevel: 6,
      intentData: intent({ safetyCategory: 'self_harm' }),
    });

    expect(result.plan.action).toBe('safety_redirect');
    expect(result.plan.allowedHintLevel).toBe(0);
    expect(result.plan.mayRevealFinalAnswer).toBe(false);
    expect(result.persistedHintLevel).toBe(6);
  });

  it('a first turn with no stored session cannot open above level zero', () => {
    const result = runTurn({
      storedLevel: null,
      claimedLevel: MAX_HINT_LEVEL,
      assistantTurns: 0,
      intentData: intent({ studentProvidedAttempt: true, attemptQuality: 'partial' }),
    });

    expect(result.effectiveHintLevel).toBe(0);
    expect(result.plan.allowedHintLevel).toBe(1);
  });
});
