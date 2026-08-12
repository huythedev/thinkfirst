import { describe, expect, it } from 'vitest';
import {
  SAFE_FALLBACK_INTENT,
  enforceResponsePlan,
  isFullSolutionAllowedThisTurn,
  parseIntentAnalysis,
  parseTutorResponse,
} from '@/lib/types/ai/model-output';
import type { TutorResponse, TutorResponsePlan } from '@/lib/types/ai/schema';

/**
 * Section 41.1: model output is untrusted input, provider-side schema enforcement
 * does not discharge the requirement, and enforcement means code rather than a
 * prompt instruction. These tests are about what a *misbehaving model* cannot
 * push through to a student.
 */

const validTutorResponse = {
  messageMarkdown: 'What happens if you subtract 3 from both sides?',
  responseType: 'question',
  hintLevel: 1,
  finalAnswerIncluded: false,
  studentActionRequired: 'Try the subtraction.',
  checkForUnderstanding: null,
  confidenceStatement: null,
  learningObjective: 'linear equations',
  internalConceptTags: ['algebra'],
};

const validIntent = {
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
};

function plan(overrides: Partial<TutorResponsePlan> = {}): TutorResponsePlan {
  return {
    action: 'provide_hint',
    allowedHintLevel: 2,
    mayRevealFinalAnswer: false,
    requiresStudentResponse: true,
    requiresExplanation: false,
    requiresVerification: false,
    generateTransferProblem: false,
    tone: 'neutral_supportive',
    maxResponseWords: 150,
    learningObjective: 'linear equations',
    rationaleCode: 'NEXT_HINT_ALLOWED',
    policyVersion: 'policy-v1',
    ...overrides,
  };
}

function response(overrides: Partial<TutorResponse> = {}): TutorResponse {
  return { ...(validTutorResponse as TutorResponse), ...overrides };
}

describe('parseTutorResponse', () => {
  it('accepts a well-formed response', () => {
    const result = parseTutorResponse(JSON.stringify(validTutorResponse));
    expect(result.ok).toBe(true);
  });

  it('rejects an empty body rather than casting it to the response type', () => {
    const result = parseTutorResponse('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_json');
  });

  it('rejects prose that is not JSON', () => {
    const result = parseTutorResponse('Sure! The answer is x = 4.');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_json');
  });

  it('rejects truncated JSON, which the provider schema does not catch', () => {
    const result = parseTutorResponse('{"messageMarkdown":"partial","responseType":');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_json');
  });

  it('rejects a hint level outside the ladder', () => {
    const result = parseTutorResponse(JSON.stringify({ ...validTutorResponse, hintLevel: 9 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('schema_mismatch');
  });

  it('rejects a response type the schema does not define', () => {
    const result = parseTutorResponse(
      JSON.stringify({ ...validTutorResponse, responseType: 'just_the_answer' }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a missing required field', () => {
    const { messageMarkdown, ...withoutMessage } = validTutorResponse;
    void messageMarkdown;
    const result = parseTutorResponse(JSON.stringify(withoutMessage));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('schema_mismatch');
  });

  it('rejects a string hint level, so a stringly-typed model cannot slip past', () => {
    const result = parseTutorResponse(JSON.stringify({ ...validTutorResponse, hintLevel: '7' }));
    expect(result.ok).toBe(false);
  });

  it('supplies null for absent optional fields rather than leaving them undefined', () => {
    const { studentActionRequired, ...withoutAction } = validTutorResponse;
    void studentActionRequired;
    const result = parseTutorResponse(JSON.stringify(withoutAction));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.studentActionRequired).toBeNull();
  });
});

describe('parseIntentAnalysis', () => {
  it('accepts a well-formed analysis', () => {
    expect(parseIntentAnalysis(JSON.stringify(validIntent)).ok).toBe(true);
  });

  it('rejects an unknown safety category', () => {
    const result = parseIntentAnalysis(
      JSON.stringify({ ...validIntent, safetyCategory: 'probably_fine' }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a confidence outside 0..1', () => {
    expect(parseIntentAnalysis(JSON.stringify({ ...validIntent, confidence: 4 })).ok).toBe(false);
  });

  it('rejects an unknown attempt quality, which gates answer disclosure', () => {
    const result = parseIntentAnalysis(
      JSON.stringify({ ...validIntent, attemptQuality: 'excellent' }),
    );
    expect(result.ok).toBe(false);
  });

  it('has a fallback that is the most restrictive analysis, not a permissive one', () => {
    expect(SAFE_FALLBACK_INTENT.studentProvidedAttempt).toBe(false);
    expect(SAFE_FALLBACK_INTENT.attemptQuality).toBe('none');
    expect(SAFE_FALLBACK_INTENT.ambiguityLevel).toBe('high');
    expect(SAFE_FALLBACK_INTENT.confidence).toBe(0);
  });
});

describe('isFullSolutionAllowedThisTurn', () => {
  it('returns false when mayRevealFinalAnswer is true but action is not provide_full_solution', () => {
    expect(
      isFullSolutionAllowedThisTurn(
        plan({ action: 'provide_hint', allowedHintLevel: 1, mayRevealFinalAnswer: true })
      )
    ).toBe(false);
  });

  it('returns false when action is provide_full_solution but allowedHintLevel is not 7', () => {
    expect(
      isFullSolutionAllowedThisTurn(
        plan({ action: 'provide_full_solution', allowedHintLevel: 6, mayRevealFinalAnswer: true })
      )
    ).toBe(false);
  });

  it('returns true only when action is provide_full_solution, allowedHintLevel is 7, and mayRevealFinalAnswer is true', () => {
    expect(
      isFullSolutionAllowedThisTurn(
        plan({ action: 'provide_full_solution', allowedHintLevel: 7, mayRevealFinalAnswer: true })
      )
    ).toBe(true);
  });
});

describe('enforceResponsePlan', () => {
  it('passes a compliant response through untouched', () => {
    const result = enforceResponsePlan(response({ hintLevel: 2 }), plan({ allowedHintLevel: 2 }));
    expect(result.violations).toEqual([]);
    expect(result.messageWithheld).toBe(false);
    expect(result.response.messageMarkdown).toBe(validTutorResponse.messageMarkdown);
  });

  it('withholds prose when the model exceeds the allowed hint level', () => {
    const overshoot = response({
      hintLevel: 6,
      messageMarkdown: 'Step 1: subtract 3. Step 2: divide by 2. So x = 4.',
    });
    const result = enforceResponsePlan(overshoot, plan({ allowedHintLevel: 2 }));

    expect(result.violations).toContain('hint_level_above_plan');
    expect(result.messageWithheld).toBe(true);
    expect(result.response.messageMarkdown).not.toContain('x = 4');
    // The delivered fallback is a question for the student's work, not a level-2 hint.
    expect(result.response.hintLevel).toBe(0);
  });

  it('withholds prose when a final answer is included against the plan', () => {
    const leak = response({
      hintLevel: 1,
      finalAnswerIncluded: true,
      messageMarkdown: 'The answer is x = 4.',
    });
    const result = enforceResponsePlan(leak, plan({ mayRevealFinalAnswer: false }));

    expect(result.violations).toContain('final_answer_forbidden');
    expect(result.response.finalAnswerIncluded).toBe(false);
    expect(result.response.messageMarkdown).not.toContain('x = 4');
  });

  it('does not merely relabel a disclosure, which would leave the text visible', () => {
    const leak = response({ finalAnswerIncluded: true, messageMarkdown: 'x = 4, done.' });
    const result = enforceResponsePlan(leak, plan({ mayRevealFinalAnswer: false }));
    expect(result.response.messageMarkdown).not.toContain('x = 4');
  });

  it('blocks a solution response type under assessment-safe policy', () => {
    const solution = response({
      responseType: 'solution',
      hintLevel: 2,
      messageMarkdown: 'Full worked solution follows.',
    });
    const result = enforceResponsePlan(
      solution,
      plan({ mayRevealFinalAnswer: false, allowedHintLevel: 2 }),
    );
    expect(result.violations).toContain('solution_type_forbidden');
    expect(result.messageWithheld).toBe(true);
  });

  it('allows a full solution when the plan permits it', () => {
    const solution = response({
      responseType: 'solution',
      hintLevel: 7,
      finalAnswerIncluded: true,
      messageMarkdown: 'x = 4, and here is why.',
    });
    const result = enforceResponsePlan(
      solution,
      plan({
        action: 'provide_full_solution',
        allowedHintLevel: 7,
        mayRevealFinalAnswer: true,
        generateTransferProblem: true,
      }),
    );
    expect(result.violations).toEqual([]);
    expect(result.response.messageMarkdown).toContain('x = 4');
  });

  it('withholds a premature solution when mayRevealFinalAnswer is true but plan is not for a full solution (Case A)', () => {
    const prematureSolution = response({
      responseType: 'solution',
      hintLevel: 1,
      finalAnswerIncluded: true,
      messageMarkdown: 'The answer is x = 4.',
    });
    const result = enforceResponsePlan(
      prematureSolution,
      plan({ action: 'provide_hint', allowedHintLevel: 1, mayRevealFinalAnswer: true }),
    );

    expect(result.violations).toContain('final_answer_forbidden');
    expect(result.violations).toContain('solution_type_forbidden');
    expect(result.messageWithheld).toBe(true);
    expect(result.response.finalAnswerIncluded).toBe(false);
    expect(result.response.messageMarkdown).not.toContain('x = 4');
  });

  it('withholds a final answer falsely labelled as a hint when plan is not for a full solution (Case B)', () => {
    const falselyLabelled = response({
      responseType: 'hint',
      hintLevel: 1,
      finalAnswerIncluded: true,
      messageMarkdown: 'The answer is x = 4.',
    });
    const result = enforceResponsePlan(
      falselyLabelled,
      plan({ action: 'provide_hint', allowedHintLevel: 1, mayRevealFinalAnswer: true }),
    );

    expect(result.violations).toContain('final_answer_forbidden');
    expect(result.messageWithheld).toBe(true);
    expect(result.response.finalAnswerIncluded).toBe(false);
    expect(result.response.messageMarkdown).not.toContain('x = 4');
  });


  it('withholds a semantic final answer leak when mayRevealFinalAnswer is true but plan is not for a full solution', () => {
    const semanticLeak = response({
      responseType: 'hint',
      hintLevel: 1,
      finalAnswerIncluded: false,
      messageMarkdown: 'Here is a small hint: x = 4.',
    });
    const result = enforceResponsePlan(
      semanticLeak,
      plan({ action: 'provide_hint', allowedHintLevel: 1, mayRevealFinalAnswer: true }),
      'en',
      true
    );
    expect(result.violations).toContain('semantic_final_answer_leak');
    expect(result.messageWithheld).toBe(true);
    expect(result.response.finalAnswerIncluded).toBe(false);
    expect(result.response.messageMarkdown).not.toContain('x = 4');
  });

  it('relabels an unrequested transfer problem without withholding it', () => {
    const transfer = response({ responseType: 'transfer_problem', hintLevel: 1 });
    const result = enforceResponsePlan(transfer, plan({ generateTransferProblem: false }));

    expect(result.violations).toContain('transfer_problem_not_requested');
    expect(result.messageWithheld).toBe(false);
    expect(result.response.responseType).toBe('question');
  });

  it('withholds in Vietnamese when the session language is Vietnamese', () => {
    const leak = response({ finalAnswerIncluded: true, messageMarkdown: 'x = 4' });
    const result = enforceResponsePlan(leak, plan({ mayRevealFinalAnswer: false }), 'vi');
    expect(result.response.messageMarkdown).toContain('giữ lại');
  });

  it('asks a question rather than offering a hint when no hint is allowed', () => {
    const leak = response({ hintLevel: 5, messageMarkdown: 'Here is the whole thing.' });
    const result = enforceResponsePlan(leak, plan({ allowedHintLevel: 0 }));
    expect(result.response.responseType).toBe('question');
    expect(result.response.hintLevel).toBe(0);
  });

  it('records every violation when a response breaks several rules at once', () => {
    const worst = response({
      responseType: 'solution',
      hintLevel: 7,
      finalAnswerIncluded: true,
    });
    const result = enforceResponsePlan(worst, plan({ allowedHintLevel: 1 }));
    expect(result.violations).toContain('hint_level_above_plan');
    expect(result.violations).toContain('final_answer_forbidden');
    expect(result.violations).toContain('solution_type_forbidden');
  });
});
