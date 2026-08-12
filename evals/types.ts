import type { LearningMode } from '@/lib/types/ai/schema';

/**
 * The evaluation case type from section 37, verbatim in shape.
 *
 * Section 37 specifies this interface directly, so it is reproduced rather than
 * redesigned. Two additions are marked below; both carry information the section
 * 37 metric list requires but the interface has no field for.
 */
export interface EvaluationCase {
  id: string;
  language: 'vi' | 'en';
  grade: number;
  mode: LearningMode;
  strictness: string;
  problem: string;
  /**
   * Server-authoritative answer used only by semantic disclosure validation.
   * This is intentionally separate from hostileModelOutput.leakedAnswer, which
   * is merely an assertion oracle for delivered text.
   */
  trustedReferenceAnswer?: string | null;
  studentMessage: string;
  priorTurns?: Array<{
    actor: 'student' | 'assistant';
    content: string;
  }>;
  expected: {
    allowedActions: string[];
    forbiddenActions: string[];
    maxHintLevel: number;
    mayRevealFinalAnswer: boolean;
    safetyCategory?: string;
  };

  /**
   * Which of section 37's seventeen required case kinds this case covers.
   *
   * Not in the section 37 interface. Added because section 37 lists the kinds
   * that must be *included* and gives no way to demonstrate coverage; without
   * this the suite could contain 100 near-duplicate cases and still claim to
   * satisfy the list. The report fails if any kind has no case.
   */
  category: CaseCategory;

  /**
   * What the classifier is taken to have returned for this case.
   *
   * The policy engine's input is an `IntentAnalysis`, which in production comes
   * from the model. Fixing it here is what makes the run deterministic, and it
   * scopes the claim honestly: this suite measures the policy and enforcement
   * layers given a classification, not the classifier's accuracy. Section 37's
   * safety-routing gate is reported as partial for exactly this reason.
   */
  classifier: ClassifierFixture;

  /**
   * Adversarial model output, for cases that test enforcement rather than
   * planning. When present, the harness feeds this to `enforceResponsePlan` and
   * checks that a model attempting to exceed the plan is actually stopped.
   */
  hostileModelOutput?: HostileModelOutput;

  /** Optional deterministic mathematics check, for the correctness metric. */
  mathCheck?: {
    studentAnswer: string;
    referenceAnswer: string;
    expected: 'equivalent' | 'not_equivalent' | 'unsupported';
  };

  /** Raw model text, for the structured-output metric. */
  rawModelOutput?: {
    kind: 'intent' | 'tutor';
    text: string;
    shouldParse: boolean;
  };

  /**
   * Session state the case starts from.
   *
   * These are server-resolved policy inputs in production
   * (`lib/session/policy-inputs.ts`), never client-supplied. They appear here
   * because a hint-ladder rule cannot be tested without a starting rung, and
   * section 18 R4 is about the transition rather than any single value.
   */
  currentHintLevel?: number;
  allowFullSolutions?: boolean;
  requireTransferProblem?: boolean;

  /** Additional expectations beyond the section 37 `expected` block. */
  expectTransferProblem?: boolean;
  expectExplanation?: boolean;
  expectVerification?: boolean;
  expectedTone?: 'simple_supportive' | 'neutral_supportive' | 'academic_supportive';

  /**
   * Probes the structured-output layer only. Such a case has no meaningful
   * policy expectation and is excluded from the policy-compliance denominator
   * rather than counted as a free pass.
   */
  structuredOutputOnly?: boolean;
}

export type CaseCategory =
  | 'direct_answer_request'
  | 'meaningful_attempt'
  | 'minimal_attempt'
  | 'correct_intermediate_step'
  | 'arithmetic_error'
  | 'conceptual_error'
  | 'ambiguous_image_extraction'
  | 'assignment_safe_session'
  | 'different_grades'
  | 'vietnamese_prompt'
  | 'english_prompt'
  | 'off_topic'
  | 'safety_sensitive'
  | 'repeated_answer_attempts'
  | 'polite_help_request'
  | 'slang'
  | 'incorrect_ai_candidate'
  | 'transfer_quality';

/**
 * The seventeen kinds section 37 requires, plus `english_prompt` which section 37
 * implies by asking for "Vietnamese and English prompts" as one bullet.
 */
export const REQUIRED_CATEGORIES: readonly CaseCategory[] = [
  'direct_answer_request',
  'meaningful_attempt',
  'minimal_attempt',
  'correct_intermediate_step',
  'arithmetic_error',
  'conceptual_error',
  'ambiguous_image_extraction',
  'assignment_safe_session',
  'different_grades',
  'vietnamese_prompt',
  'english_prompt',
  'off_topic',
  'safety_sensitive',
  'repeated_answer_attempts',
  'polite_help_request',
  'slang',
  'incorrect_ai_candidate',
  'transfer_quality',
] as const;

export interface ClassifierFixture {
  intent:
    | 'concept_explanation'
    | 'problem_solving'
    | 'step_check'
    | 'answer_request'
    | 'homework_completion'
    | 'verification'
    | 'off_topic'
    | 'unsafe'
    | 'unclear';
  subject: 'mathematics' | 'science' | 'other';
  topic: string | null;
  studentProvidedAttempt: boolean;
  attemptQuality: 'none' | 'minimal' | 'partial' | 'meaningful';
  answerSeekingLikelihood: number;
  ambiguityLevel: 'low' | 'medium' | 'high';
  missingInformation: string[];
  detectedLanguage: 'vi' | 'en' | 'other';
  safetyCategory:
    | 'none'
    | 'self_harm'
    | 'abuse'
    | 'sexual_content'
    | 'violence'
    | 'illegal_activity'
    | 'bullying'
    | 'personal_data'
    | 'other';
  confidence: number;
  /** Extraction confidence, when the problem came from an image (rule R6). */
  extractionConfidence?: number;
}

export interface HostileModelOutput {
  messageMarkdown: string;
  responseType:
    | 'question'
    | 'hint'
    | 'feedback'
    | 'explanation'
    | 'worked_step'
    | 'solution'
    | 'transfer_problem'
    | 'safety_message';
  hintLevel: number;
  finalAnswerIncluded: boolean;
  /** Every student-visible generated field is part of the disclosure surface. */
  studentActionRequired?: string | null;
  checkForUnderstanding?: string | null;
  confidenceStatement?: string | null;
  learningObjective?: string | null;
  /**
   * The literal final answer this hostile output tries to smuggle through.
   * Leakage is measured by searching the delivered message for this string, so
   * an enforcement layer that only rewrites metadata is caught.
   */
  leakedAnswer: string;
}
