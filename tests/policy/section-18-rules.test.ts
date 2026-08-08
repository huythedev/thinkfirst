import { describe, expect, it } from 'vitest';
import {
  POLICY_VERSION,
  generateResponsePlan,
  type PolicyInput,
} from '@/services/ai-gateway/src/policy';
import type { IntentAnalysis } from '@/lib/types/ai/schema';

/**
 * Section 18 gives nine deterministic rules. The Phase 4 exit criterion is that
 * tests cover every one of them "including the negative cases", so each rule below
 * gets a positive test and at least one negative: a case where the antecedent is
 * *almost* satisfied and the consequent must therefore not fire.
 *
 * Rule numbering matches the `R1`..`R9` comments in the policy engine.
 */

function intent(overrides: Partial<IntentAnalysis> = {}): IntentAnalysis {
  return {
    intent: 'problem_solving',
    subject: 'mathematics',
    topic: 'linear equations',
    estimatedGradeLevel: 8,
    problemStatement: '2x + 3 = 11',
    studentProvidedAttempt: true,
    attemptQuality: 'partial',
    answerSeekingLikelihood: 0.4,
    ambiguityLevel: 'low',
    missingInformation: [],
    detectedLanguage: 'en',
    safetyCategory: 'none',
    confidence: 0.9,
    ...overrides,
  };
}

function config(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    mode: 'practice',
    strictness: 'balanced',
    currentHintLevel: 0,
    hasReceivedFullSolution: false,
    grade: 8,
    ...overrides,
  };
}

describe('R1: assessment-safe forbids final answers', () => {
  it('blocks final answer disclosure', () => {
    const plan = generateResponsePlan(intent(), config({ strictness: 'assessment_safe' }));
    expect(plan.mayRevealFinalAnswer).toBe(false);
  });

  it('holds the ladder below the worked-step rungs', () => {
    const plan = generateResponsePlan(
      intent(),
      config({ strictness: 'assessment_safe', currentHintLevel: 6 }),
    );
    expect(plan.allowedHintLevel).toBeLessThanOrEqual(4);
  });

  it('never escalates to a full solution, even after one was already given', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'answer_request' }),
      config({
        strictness: 'assessment_safe',
        currentHintLevel: 7,
        hasReceivedFullSolution: true,
      }),
    );
    expect(plan.action).not.toBe('provide_full_solution');
    expect(plan.mayRevealFinalAnswer).toBe(false);
    expect(plan.rationaleCode).toBe('ASSESSMENT_FINAL_ANSWER_BLOCKED');
  });

  it('negative: balanced strictness may reveal a final answer', () => {
    const plan = generateResponsePlan(intent(), config({ strictness: 'balanced' }));
    expect(plan.mayRevealFinalAnswer).toBe(true);
  });

  it('an assignment forbidding full solutions blocks them under any strictness', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'answer_request' }),
      config({ strictness: 'supportive', currentHintLevel: 6, allowFullSolutions: false }),
    );
    expect(plan.mayRevealFinalAnswer).toBe(false);
    expect(plan.action).not.toBe('provide_full_solution');
    expect(plan.allowedHintLevel).toBeLessThanOrEqual(6);
  });
});

describe('R2: assignment mode with no attempt asks for the attempt', () => {
  it('fires under balanced strictness', () => {
    const plan = generateResponsePlan(
      intent({ studentProvidedAttempt: false, attemptQuality: 'none' }),
      config({ mode: 'assignment', strictness: 'balanced' }),
    );
    expect(plan.action).toBe('ask_for_attempt');
    expect(plan.allowedHintLevel).toBe(0);
    expect(plan.rationaleCode).toBe('ATTEMPT_REQUIRED');
  });

  it('fires under independence strictness', () => {
    const plan = generateResponsePlan(
      intent({ studentProvidedAttempt: false, attemptQuality: 'none' }),
      config({ mode: 'assignment', strictness: 'independence' }),
    );
    expect(plan.action).toBe('ask_for_attempt');
  });

  it('fires under assessment-safe strictness', () => {
    const plan = generateResponsePlan(
      intent({ studentProvidedAttempt: false, attemptQuality: 'none' }),
      config({ mode: 'assignment', strictness: 'assessment_safe' }),
    );
    expect(plan.action).toBe('ask_for_attempt');
  });

  it('refuses to escalate even from a high stored level', () => {
    const plan = generateResponsePlan(
      intent({ studentProvidedAttempt: false, attemptQuality: 'none' }),
      config({ mode: 'assignment', strictness: 'balanced', currentHintLevel: 6 }),
    );
    expect(plan.allowedHintLevel).toBe(0);
  });

  it('negative: supportive strictness is exempt, as section 18 lists only the stricter three', () => {
    const plan = generateResponsePlan(
      intent({ studentProvidedAttempt: false, attemptQuality: 'none' }),
      config({ mode: 'assignment', strictness: 'supportive' }),
    );
    expect(plan.action).not.toBe('ask_for_attempt');
  });

  it('negative: an attempt already provided does not trigger the demand', () => {
    const plan = generateResponsePlan(
      intent({ studentProvidedAttempt: true, attemptQuality: 'partial' }),
      config({ mode: 'assignment', strictness: 'balanced' }),
    );
    expect(plan.action).not.toBe('ask_for_attempt');
  });

  it('the general form applies outside assignment mode: no attempt, no progression', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'answer_request', studentProvidedAttempt: false, attemptQuality: 'none' }),
      config({ mode: 'practice', strictness: 'balanced' }),
    );
    expect(plan.action).toBe('ask_for_attempt');
    expect(plan.allowedHintLevel).toBe(0);
  });

  it('negative: learn mode relaxes the attempt requirement outside assignments', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'answer_request', studentProvidedAttempt: false, attemptQuality: 'none' }),
      config({ mode: 'learn', strictness: 'balanced' }),
    );
    expect(plan.action).not.toBe('ask_for_attempt');
  });
});

describe('R3: a meaningful attempt plus a step check is evaluated', () => {
  it('evaluates the step', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'step_check', attemptQuality: 'meaningful' }),
      config(),
    );
    expect(plan.action).toBe('evaluate_step');
    expect(plan.rationaleCode).toBe('EVALUATE_MEANINGFUL_STEP');
  });

  it('does not spend a rung of the ladder on feedback', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'step_check', attemptQuality: 'meaningful' }),
      config({ currentHintLevel: 3 }),
    );
    expect(plan.allowedHintLevel).toBe(3);
  });

  it('negative: a step check without a meaningful attempt is not an evaluation', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'step_check', attemptQuality: 'minimal' }),
      config(),
    );
    expect(plan.action).not.toBe('evaluate_step');
  });

  it('negative: a meaningful attempt that is not a step check is not an evaluation', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'answer_request', attemptQuality: 'meaningful' }),
      config(),
    );
    expect(plan.action).not.toBe('evaluate_step');
  });
});

describe('R4: increase the hint level by at most one', () => {
  it('advances exactly one rung', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'answer_request' }),
      config({ currentHintLevel: 2 }),
    );
    expect(plan.allowedHintLevel).toBe(3);
    expect(plan.rationaleCode).toBe('NEXT_HINT_ALLOWED');
  });

  it('advances by one from every rung below the ceiling, and never by two', () => {
    for (let level = 0; level < 6; level += 1) {
      const plan = generateResponsePlan(
        intent({ intent: 'problem_solving' }),
        config({ currentHintLevel: level }),
      );
      expect(plan.allowedHintLevel).toBe(level + 1);
    }
  });

  it('negative: it does not advance past the progression ceiling by progression alone', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'concept_explanation' }),
      config({ currentHintLevel: 6 }),
    );
    expect(plan.allowedHintLevel).toBe(6);
  });

  it('negative: a concept question does not advance the ladder', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'concept_explanation' }),
      config({ currentHintLevel: 2 }),
    );
    expect(plan.allowedHintLevel).toBe(2);
    expect(plan.action).toBe('provide_concept');
  });

  it('clamps a corrupt stored level instead of trusting it', () => {
    const plan = generateResponsePlan(intent({ intent: 'step_check' }), config({ currentHintLevel: 99 }));
    expect(plan.allowedHintLevel).toBeLessThanOrEqual(7);
  });
});

describe('R5: a full solution requires reflection and a transfer problem', () => {
  it('reaches level 7 from the ceiling when disclosure is permitted', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'answer_request' }),
      config({ currentHintLevel: 6, strictness: 'balanced' }),
    );
    expect(plan.allowedHintLevel).toBe(7);
    expect(plan.action).toBe('provide_full_solution');
  });

  it('requires reflection and a transfer problem once a solution is given', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'answer_request' }),
      config({ currentHintLevel: 6, hasReceivedFullSolution: true }),
    );
    expect(plan.generateTransferProblem).toBe(true);
    expect(plan.requiresStudentResponse).toBe(true);
    expect(plan.requiresExplanation).toBe(true);
    expect(plan.rationaleCode).toBe('FULL_SOLUTION_AFTER_ENGAGEMENT');
  });

  it('negative: level 7 is unreachable when disclosure is forbidden', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'answer_request' }),
      config({ currentHintLevel: 6, strictness: 'assessment_safe' }),
    );
    expect(plan.allowedHintLevel).toBeLessThan(7);
  });

  it('negative: a mid-ladder turn does not trigger the full-solution branch', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'answer_request' }),
      config({ currentHintLevel: 2 }),
    );
    expect(plan.action).not.toBe('provide_full_solution');
    expect(plan.generateTransferProblem).toBe(false);
  });

  it('an assignment requiring transfer practice gets it above level 5', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'answer_request' }),
      config({ currentHintLevel: 5, requireTransferProblem: true, allowFullSolutions: false }),
    );
    expect(plan.generateTransferProblem).toBe(true);
    expect(plan.rationaleCode).toBe('TRANSFER_REQUIRED');
  });
});

describe('R6: low image-extraction confidence must be confirmed first', () => {
  it('asks the student to confirm the extracted text', () => {
    const plan = generateResponsePlan(intent(), config({ extractionConfidence: 0.4 }));
    expect(plan.action).toBe('clarify_problem');
    expect(plan.rationaleCode).toBe('LOW_EXTRACTION_CONFIDENCE');
    expect(plan.allowedHintLevel).toBe(0);
  });

  it('does not begin tutoring before confirmation, whatever the stored level', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'answer_request' }),
      config({ currentHintLevel: 6, extractionConfidence: 0.2 }),
    );
    expect(plan.action).toBe('clarify_problem');
    expect(plan.mayRevealFinalAnswer).toBe(false);
  });

  it('negative: high extraction confidence proceeds normally', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'answer_request' }),
      config({ extractionConfidence: 0.95 }),
    );
    expect(plan.rationaleCode).not.toBe('LOW_EXTRACTION_CONFIDENCE');
  });

  it('negative: a typed problem carries no extraction confidence and is unaffected', () => {
    const plan = generateResponsePlan(intent({ intent: 'answer_request' }), config());
    expect(plan.action).not.toBe('clarify_problem');
  });
});

describe('R7: an ambiguous problem is clarified before solving', () => {
  it('clarifies on high ambiguity', () => {
    const plan = generateResponsePlan(intent({ ambiguityLevel: 'high' }), config());
    expect(plan.action).toBe('clarify_problem');
    expect(plan.rationaleCode).toBe('AMBIGUOUS_PROBLEM');
  });

  it('clarifies when information is missing', () => {
    const plan = generateResponsePlan(
      intent({ missingInformation: ['Which variable should be solved for?'] }),
      config(),
    );
    expect(plan.action).toBe('clarify_problem');
  });

  it('does not disclose an answer while the problem is still ambiguous', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'answer_request', ambiguityLevel: 'high' }),
      config({ currentHintLevel: 6 }),
    );
    expect(plan.mayRevealFinalAnswer).toBe(false);
    expect(plan.action).toBe('clarify_problem');
  });

  it('holds the earned level rather than resetting it to zero', () => {
    const plan = generateResponsePlan(
      intent({ ambiguityLevel: 'high' }),
      config({ currentHintLevel: 4 }),
    );
    expect(plan.allowedHintLevel).toBe(4);
  });

  it('negative: medium ambiguity with nothing missing proceeds', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'answer_request', ambiguityLevel: 'medium' }),
      config(),
    );
    expect(plan.action).not.toBe('clarify_problem');
  });
});

describe('R8: a safety category invokes the safety policy', () => {
  const categories = [
    'self_harm',
    'abuse',
    'sexual_content',
    'violence',
    'illegal_activity',
    'bullying',
    'personal_data',
    'other',
  ] as const;

  for (const category of categories) {
    it(`redirects on ${category}`, () => {
      const plan = generateResponsePlan(intent({ safetyCategory: category }), config());
      expect(plan.action).toBe('safety_redirect');
      expect(plan.allowedHintLevel).toBe(0);
      expect(plan.mayRevealFinalAnswer).toBe(false);
      expect(plan.rationaleCode).toBe('SAFETY_REDIRECT');
    });
  }

  it('overrides an already-earned full solution', () => {
    const plan = generateResponsePlan(
      intent({ safetyCategory: 'self_harm', intent: 'answer_request' }),
      config({ currentHintLevel: 7, hasReceivedFullSolution: true, strictness: 'supportive' }),
    );
    expect(plan.action).toBe('safety_redirect');
    expect(plan.allowedHintLevel).toBe(0);
  });

  it('does not leak the topic into the plan', () => {
    const plan = generateResponsePlan(intent({ safetyCategory: 'abuse' }), config());
    expect(plan.learningObjective).toBeNull();
  });

  it('negative: safetyCategory none does not redirect', () => {
    const plan = generateResponsePlan(intent({ safetyCategory: 'none' }), config());
    expect(plan.action).not.toBe('safety_redirect');
  });
});

describe('R9: low model confidence communicates uncertainty and suggests verification', () => {
  it('requires verification when the classifier is unsure', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'step_check', confidence: 0.2 }),
      config(),
    );
    expect(plan.requiresVerification).toBe(true);
  });

  it('records the low-confidence rationale when nothing stronger applies', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'step_check', attemptQuality: 'minimal', confidence: 0.1 }),
      config(),
    );
    expect(plan.rationaleCode).toBe('LOW_MODEL_CONFIDENCE');
  });

  it('negative: high confidence outside verify mode requires no verification', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'step_check', confidence: 0.95 }),
      config({ mode: 'practice' }),
    );
    expect(plan.requiresVerification).toBe(false);
  });

  it('negative: low confidence does not itself widen disclosure', () => {
    const plan = generateResponsePlan(
      intent({ intent: 'answer_request', confidence: 0.1 }),
      config({ strictness: 'assessment_safe' }),
    );
    expect(plan.mayRevealFinalAnswer).toBe(false);
  });

  it('verify mode always requires verification', () => {
    const plan = generateResponsePlan(intent({ confidence: 0.99 }), config({ mode: 'verify' }));
    expect(plan.requiresVerification).toBe(true);
  });
});

describe('plan provenance and grade behavior', () => {
  it('stamps a rationale code and policy version on every branch', () => {
    const cases: Array<[IntentAnalysis, PolicyInput]> = [
      [intent({ safetyCategory: 'self_harm' }), config()],
      [intent({ intent: 'off_topic' }), config()],
      [intent({ ambiguityLevel: 'high' }), config()],
      [intent(), config({ extractionConfidence: 0.1 })],
      [intent({ studentProvidedAttempt: false, attemptQuality: 'none' }), config({ mode: 'assignment' })],
      [intent({ intent: 'step_check', attemptQuality: 'meaningful' }), config()],
      [intent({ intent: 'concept_explanation' }), config()],
      [intent({ intent: 'verification' }), config({ mode: 'verify' })],
      [intent({ intent: 'answer_request' }), config({ currentHintLevel: 6 })],
      [intent({ intent: 'answer_request' }), config({ strictness: 'assessment_safe' })],
    ];

    for (const [analysis, input] of cases) {
      const plan = generateResponsePlan(analysis, input);
      expect(plan.rationaleCode.length).toBeGreaterThan(0);
      expect(plan.policyVersion).toBe(POLICY_VERSION);
    }
  });

  it('uses simpler language and shorter responses for the youngest band', () => {
    const plan = generateResponsePlan(intent(), config({ grade: 4 }));
    expect(plan.tone).toBe('simple_supportive');
    expect(plan.maxResponseWords).toBeLessThan(150);
  });

  it('uses the primary profile for grades 6 to 9', () => {
    const plan = generateResponsePlan(intent(), config({ grade: 8 }));
    expect(plan.tone).toBe('neutral_supportive');
  });

  it('uses a more technical register for grades 10 to 12', () => {
    const plan = generateResponsePlan(intent(), config({ grade: 11 }));
    expect(plan.tone).toBe('academic_supportive');
    expect(plan.maxResponseWords).toBeGreaterThan(150);
  });

  it('is deterministic: the same inputs give the same plan', () => {
    const first = generateResponsePlan(intent(), config({ currentHintLevel: 3 }));
    const second = generateResponsePlan(intent(), config({ currentHintLevel: 3 }));
    expect(first).toEqual(second);
  });
});
