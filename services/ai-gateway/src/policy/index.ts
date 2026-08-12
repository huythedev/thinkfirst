import { IntentAnalysis, TutorResponsePlan } from '@/lib/types/ai/schema';
import { requiresExtractionConfirmation } from '@/lib/images/confidence';

/**
 * The deterministic policy engine.
 *
 * Section 16: the model must not decide its own permissions. Every disclosure
 * decision is made here, in code, before generation, and enforced again after
 * generation by `enforceResponsePlan`.
 *
 * Section 18 gives nine rules. Each is implemented below and labelled `R1`..`R9`
 * so the tests in `tests/policy/section-18-rules.test.ts` map one-to-one onto the
 * instruction text. Two points where section 18 is ambiguous, resolved here and
 * recorded in `docs/ASSUMPTIONS.md`:
 *
 * - R1 says `mode = assessment-safe`, but `assessment_safe` is a *strictness*
 *   value per module 02 section 9, and R2 in the same block treats mode and
 *   strictness as separate fields. Implemented as strictness.
 * - Section 18 never states whether level 7 is reachable by progression. It is
 *   implemented per the audit's P3 recommendation: levels 0-6 by progression,
 *   level 7 only when `mayRevealFinalAnswer` is true.
 */

export const POLICY_VERSION = 'policy-v2';

/** Level 6 is the ceiling for ordinary progression; 7 requires permission. */
const PROGRESSION_CEILING = 6;
const FULL_SOLUTION_LEVEL = 7;

/** Assessment-safe permits no worked steps, so it stops below level 5. */
const ASSESSMENT_SAFE_CEILING = 4;

/** Below this, the classifier is not sure enough to assert without hedging (R9). */
const LOW_CONFIDENCE_THRESHOLD = 0.5;

export type HintLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type PolicyMode = 'learn' | 'practice' | 'assignment' | 'verify';
export type PolicyStrictness = 'supportive' | 'balanced' | 'independence' | 'assessment_safe';

export interface PolicyInput {
  mode: PolicyMode;
  strictness: PolicyStrictness;
  currentHintLevel: number;
  hasReceivedFullSolution: boolean;
  /** Grade drives tone and length per module 02 section 10. */
  grade?: number;
  /** From `assignments/{id}`. Undefined means no assignment governs this session. */
  allowFullSolutions?: boolean;
  requireTransferProblem?: boolean;
  hasPendingTransferProblem?: boolean;
  /**
   * Confidence of image-to-text extraction, when the problem came from an image.
   * Undefined means the problem was typed, which is the only path today (R6).
   */
  extractionConfidence?: number;
}

export type RationaleCode =
  | 'SAFETY_REDIRECT'
  | 'OFF_TOPIC_REDIRECT'
  | 'LOW_EXTRACTION_CONFIDENCE'
  | 'AMBIGUOUS_PROBLEM'
  | 'ATTEMPT_REQUIRED'
  | 'ASSESSMENT_FINAL_ANSWER_BLOCKED'
  | 'EVALUATE_MEANINGFUL_STEP'
  | 'NEXT_HINT_ALLOWED'
  | 'HINT_CEILING_REACHED'
  | 'FULL_SOLUTION_AFTER_ENGAGEMENT'
  | 'TRANSFER_REQUIRED'
  | 'LOW_MODEL_CONFIDENCE'
  | 'VERIFICATION_REQUESTED'
  | 'CONCEPT_EXPLANATION_ALLOWED'
  | 'DEFAULT_HINT_ALLOWED';

function clampLevel(value: number): HintLevel {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), FULL_SOLUTION_LEVEL) as HintLevel;
}

/** Module 02 section 10: three grade bands, each with its own register. */
function toneForGrade(grade: number | undefined): TutorResponsePlan['tone'] {
  if (grade === undefined) return 'neutral_supportive';
  if (grade <= 5) return 'simple_supportive';
  if (grade <= 9) return 'neutral_supportive';
  return 'academic_supportive';
}

function wordsForGrade(grade: number | undefined): number {
  if (grade === undefined) return 150;
  if (grade <= 5) return 90;
  if (grade <= 9) return 150;
  return 220;
}

export function generateResponsePlan(
  intentData: IntentAnalysis,
  sessionConfig: PolicyInput,
): TutorResponsePlan {
  const {
    mode,
    strictness,
    currentHintLevel,
    hasReceivedFullSolution,
    grade,
    allowFullSolutions,
    requireTransferProblem,
    extractionConfidence,
  } = sessionConfig;

  const startLevel = clampLevel(currentHintLevel);
  const base = {
    tone: toneForGrade(grade),
    maxResponseWords: wordsForGrade(grade),
    // Classifier topic is untrusted model prose. A response plan is persisted
    // and returned to the student, so it must not carry that prose across the
    // boundary. Internal callers retain `intentData.topic` in memory only.
    learningObjective: null,
    policyVersion: POLICY_VERSION,
  };

  // R8. Safety overrides everything, including a student who has already earned a
  // full solution. No branch below can re-raise the level after this returns.
  if (intentData.safetyCategory !== 'none') {
    return {
      ...base,
      action: 'safety_redirect',
      allowedHintLevel: 0,
      mayRevealFinalAnswer: false,
      requiresStudentResponse: false,
      requiresExplanation: false,
      requiresVerification: false,
      generateTransferProblem: false,
      maxResponseWords: 100,
      learningObjective: null,
      rationaleCode: 'SAFETY_REDIRECT',
    };
  }

  // Off-topic is not unsafe, but it is not tutoring either, so it does not
  // advance the ladder.
  if (intentData.intent === 'off_topic') {
    return {
      ...base,
      action: 'off_topic_redirect',
      allowedHintLevel: startLevel,
      mayRevealFinalAnswer: false,
      requiresStudentResponse: true,
      requiresExplanation: false,
      requiresVerification: false,
      generateTransferProblem: false,
      maxResponseWords: 100,
      learningObjective: null,
      rationaleCode: 'OFF_TOPIC_REDIRECT',
    };
  }

  // R6. A problem read out of an image with low extraction confidence is
  // confirmed before it is tutored, otherwise the tutor teaches the wrong problem
  // with full confidence.
  //
  // The threshold is shared with the upload route and the workspace UI rather
  // than restated here, so the rule that blocks tutoring and the prompt that asks
  // for confirmation cannot disagree about what "low" means.
  if (extractionConfidence !== undefined && requiresExtractionConfirmation(extractionConfidence)) {
    return {
      ...base,
      action: 'clarify_problem',
      allowedHintLevel: 0,
      mayRevealFinalAnswer: false,
      requiresStudentResponse: true,
      requiresExplanation: false,
      requiresVerification: false,
      generateTransferProblem: false,
      maxResponseWords: 100,
      rationaleCode: 'LOW_EXTRACTION_CONFIDENCE',
    };
  }

  // R7. Clarify before solving. The level is held rather than reset: a student at
  // level 4 does not lose that ground by asking one vague question.
  if (intentData.ambiguityLevel === 'high' || intentData.missingInformation.length > 0) {
    return {
      ...base,
      action: 'clarify_problem',
      allowedHintLevel: startLevel,
      mayRevealFinalAnswer: false,
      requiresStudentResponse: true,
      requiresExplanation: false,
      requiresVerification: false,
      generateTransferProblem: false,
      maxResponseWords: 100,
      rationaleCode: 'AMBIGUOUS_PROBLEM',
    };
  }

  let allowedHintLevel: HintLevel = startLevel;
  let action: TutorResponsePlan['action'] = 'provide_hint';
  let rationaleCode: RationaleCode = 'DEFAULT_HINT_ALLOWED';
  let generateTransferProblem = false;
  const requiresStudentResponse = true;

  // R1. Assessment-safe forbids final answers outright, and an assignment can
  // forbid them independently of strictness.
  const assessmentSafe = strictness === 'assessment_safe';
  const assignmentForbidsSolutions = allowFullSolutions === false;
  let mayRevealFinalAnswer = !assessmentSafe && !assignmentForbidsSolutions;

  // R2. Assignment mode, no attempt, anything stricter than supportive: ask for
  // the attempt before offering help.
  const requiresAttemptFirst =
    mode === 'assignment' &&
    !intentData.studentProvidedAttempt &&
    (strictness === 'balanced' || strictness === 'independence' || assessmentSafe);

  if (requiresAttemptFirst) {
    return {
      ...base,
      action: 'ask_for_attempt',
      allowedHintLevel: 0,
      mayRevealFinalAnswer: false,
      requiresStudentResponse: true,
      requiresExplanation: false,
      // Unreachable in this branch: `requiresAttemptFirst` implies assignment mode.
      requiresVerification: false,
      generateTransferProblem: false,
      rationaleCode: 'ATTEMPT_REQUIRED',
    };
  }

  const solutionRequested =
    intentData.intent === 'answer_request' ||
    intentData.intent === 'problem_solving' ||
    intentData.intent === 'homework_completion';

  // R3. A meaningful attempt plus a request to check a step is evaluated, not
  // hinted at. Feedback on work already done does not consume a rung.
  if (intentData.attemptQuality === 'meaningful' && intentData.intent === 'step_check') {
    action = 'evaluate_step';
    rationaleCode = 'EVALUATE_MEANINGFUL_STEP';
  } else if (intentData.intent === 'concept_explanation') {
    // A concept question is answerable without disclosing this problem's answer.
    action = 'provide_concept';
    rationaleCode = 'CONCEPT_EXPLANATION_ALLOWED';
  } else if (intentData.intent === 'verification') {
    action = 'start_verification_task';
    rationaleCode = 'VERIFICATION_REQUESTED';
  } else if (solutionRequested) {
    const earnedProgression =
      intentData.attemptQuality !== 'none' || strictness === 'supportive' || mode === 'learn';

    if (!earnedProgression) {
      // R2's general form: no attempt and no relaxation means no escalation.
      return {
        ...base,
        action: 'ask_for_attempt',
        allowedHintLevel: 0,
        mayRevealFinalAnswer: false,
        requiresStudentResponse: true,
        requiresExplanation: false,
        requiresVerification: mode === 'verify',
        generateTransferProblem: false,
        rationaleCode: 'ATTEMPT_REQUIRED',
      };
    }

    // R4. At most one rung per turn, and never past the progression ceiling.
    // Level 7 is reached only through the full-solution branch below.
    if (allowedHintLevel < PROGRESSION_CEILING && !assessmentSafe) {
      allowedHintLevel = (allowedHintLevel + 1) as HintLevel;
      rationaleCode = 'NEXT_HINT_ALLOWED';
    } else {
      rationaleCode = assessmentSafe ? 'ASSESSMENT_FINAL_ANSWER_BLOCKED' : 'HINT_CEILING_REACHED';
    }
  }

  // R5. Level 7 is the full-solution rung, reachable only when disclosure is
  // permitted. Reaching it obliges reflection and a transfer problem.
  //
  // The test is on `startLevel`, not on the level after progression above. R4
  // allows at most one rung per turn, so a student arriving at level 5 advances
  // to 6 and must take one more turn to earn 7. Testing the post-progression
  // value would let a single turn move 5 -> 7.
  if (
    mayRevealFinalAnswer &&
    (hasReceivedFullSolution || (startLevel >= PROGRESSION_CEILING && solutionRequested))
  ) {
    allowedHintLevel = FULL_SOLUTION_LEVEL;
    action = 'provide_full_solution';
    generateTransferProblem = true;
    rationaleCode = 'FULL_SOLUTION_AFTER_ENGAGEMENT';
  }

  // R1 as a terminal clamp. Assessment-safe permits clarification, conceptual
  // reminders and process feedback only (module 02 section 9), so it stops short
  // of a worked step.
  if (assessmentSafe) {
    mayRevealFinalAnswer = false;
    allowedHintLevel = Math.min(allowedHintLevel, ASSESSMENT_SAFE_CEILING) as HintLevel;
    if (action === 'provide_full_solution') {
      action = 'provide_hint';
      generateTransferProblem = false;
      rationaleCode = 'ASSESSMENT_FINAL_ANSWER_BLOCKED';
    }
  }

  if (assignmentForbidsSolutions) {
    mayRevealFinalAnswer = false;
    allowedHintLevel = Math.min(allowedHintLevel, PROGRESSION_CEILING) as HintLevel;
    if (action === 'provide_full_solution') {
      action = 'provide_partial_solution';
      rationaleCode = 'ASSESSMENT_FINAL_ANSWER_BLOCKED';
    }
  }

  // An assignment can require transfer practice however far the student climbed.
  if (requireTransferProblem && allowedHintLevel >= 5) {
    generateTransferProblem = true;
    if (rationaleCode !== 'FULL_SOLUTION_AFTER_ENGAGEMENT') {
      rationaleCode = 'TRANSFER_REQUIRED';
    }
  }

  if (sessionConfig.hasPendingTransferProblem) {
    generateTransferProblem = false;
  }

  // R9. Low confidence must be communicated and verification suggested. It does
  // not change disclosure, so it is recorded only when no stronger rationale
  // already applies.
  const lowConfidence = intentData.confidence < LOW_CONFIDENCE_THRESHOLD;
  if (lowConfidence && rationaleCode === 'DEFAULT_HINT_ALLOWED') {
    rationaleCode = 'LOW_MODEL_CONFIDENCE';
  }

  return {
    ...base,
    action,
    allowedHintLevel,
    mayRevealFinalAnswer,
    requiresStudentResponse,
    requiresExplanation: allowedHintLevel >= 5 || generateTransferProblem,
    // R9: verification is required in verify mode, and whenever the classifier is
    // not confident about what it read.
    requiresVerification: mode === 'verify' || lowConfidence,
    generateTransferProblem,
    rationaleCode,
  };
}
