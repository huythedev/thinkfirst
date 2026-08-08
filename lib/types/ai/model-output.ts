import { z } from 'zod';
import { MAX_HINT_LEVEL } from '@/lib/types/ai/request';
import type { IntentAnalysis, TutorResponse, TutorResponsePlan } from '@/lib/types/ai/schema';

/**
 * The generative model sits on the far side of a trust boundary, in both
 * directions (section 41.1, "Model output is untrusted input").
 *
 * Provider-side `responseSchema` enforcement is a hint. It is best-effort, it is
 * not applied when a call falls back or is retried, and a malformed or truncated
 * body still parses as JSON. So everything the model returns is revalidated here
 * before it is trusted, persisted or returned, and the response plan is then
 * enforced in code rather than requested in a prompt.
 */

const HINT_LEVEL_VALUES = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export const intentAnalysisSchema = z.object({
  intent: z.enum([
    'concept_explanation',
    'problem_solving',
    'step_check',
    'answer_request',
    'homework_completion',
    'verification',
    'off_topic',
    'unsafe',
    'unclear',
  ]),
  subject: z.enum(['mathematics', 'science', 'other']),
  topic: z.string().max(200).nullable().default(null),
  estimatedGradeLevel: z.number().int().min(1).max(12).nullable().default(null),
  problemStatement: z.string().max(5000).nullable().default(null),
  studentProvidedAttempt: z.boolean(),
  attemptQuality: z.enum(['none', 'minimal', 'partial', 'meaningful']),
  answerSeekingLikelihood: z.number().min(0).max(1),
  ambiguityLevel: z.enum(['low', 'medium', 'high']),
  missingInformation: z.array(z.string().max(500)).max(20),
  detectedLanguage: z.enum(['vi', 'en', 'other']),
  safetyCategory: z.enum([
    'none',
    'self_harm',
    'abuse',
    'sexual_content',
    'violence',
    'illegal_activity',
    'bullying',
    'personal_data',
    'other',
  ]),
  confidence: z.number().min(0).max(1),
});

export const tutorResponseSchema = z.object({
  messageMarkdown: z.string().min(1).max(20000),
  responseType: z.enum([
    'question',
    'hint',
    'feedback',
    'explanation',
    'worked_step',
    'solution',
    'transfer_problem',
    'safety_message',
  ]),
  hintLevel: z.union(HINT_LEVEL_VALUES.map((level) => z.literal(level)) as [
    z.ZodLiteral<0>,
    z.ZodLiteral<1>,
    z.ZodLiteral<2>,
    z.ZodLiteral<3>,
    z.ZodLiteral<4>,
    z.ZodLiteral<5>,
    z.ZodLiteral<6>,
    z.ZodLiteral<7>,
  ]),
  finalAnswerIncluded: z.boolean(),
  studentActionRequired: z.string().max(2000).nullable().default(null),
  checkForUnderstanding: z.string().max(2000).nullable().default(null),
  confidenceStatement: z.string().max(2000).nullable().default(null),
  learningObjective: z.string().max(500).nullable().default(null),
  internalConceptTags: z.array(z.string().max(100)).max(20),
});

/**
 * Attempt and explanation evaluation, per section 21 and §56.2.
 *
 * The rubric fields are strict booleans on purpose. A model that hedges with a
 * number where a criterion belongs is rejected rather than coerced, because a
 * coerced rubric is how v1's "ratio of turns" defect gets reintroduced by
 * accident: §56.2 requires per-criterion booleans with evidence spans, never a
 * bare score.
 */
export const reasoningRubricSchema = z.object({
  identifiedMethod: z.boolean(),
  explainedIntermediateStep: z.boolean(),
  connectedToConcept: z.boolean(),
  interpretedResult: z.boolean(),
  confidence: z.number().min(0).max(1),
  evidenceSpans: z.array(z.string().max(1000)).max(8).default([]),
});

export const verificationRubricSchema = z.object({
  recomputedOrSubstituted: z.boolean(),
  checkedUnitsOrPlausibility: z.boolean(),
  statedAssumptionOrLimitation: z.boolean(),
  correctlyJudgedContent: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export const attemptEvaluationSchema = z.object({
  relevance: z.number().min(0).max(1),
  correctness: z.number().min(0).max(1),
  reasoningQuality: z.number().min(0).max(1),
  earliestMeaningfulError: z.string().max(2000).nullable().default(null),
  errorCategory: z.enum([
    'none',
    'misread_problem',
    'concept_error',
    'formula_selection',
    'algebra_error',
    'arithmetic_error',
    'unit_error',
    'notation_error',
    'unsupported_claim',
    'incomplete_reasoning',
    'other',
  ]),
  understands: z.string().max(2000).default(''),
  missingPrerequisite: z.string().max(1000).nullable().default(null),
  smallestUsefulNextHint: z.string().max(2000).nullable().default(null),
  feedbackSummary: z.string().max(2000).default(''),
  confidence: z.number().min(0).max(1),
  reasoningRubric: reasoningRubricSchema,
  verificationRubric: verificationRubricSchema,
  /** The student's final answer, extracted so code can check it deterministically. */
  extractedAnswer: z.string().max(500).nullable().default(null),
});

export type AttemptEvaluation = z.infer<typeof attemptEvaluationSchema>;

/**
 * Transfer problem, per section 22. `internalAnswer` is required and non-empty:
 * a transfer problem without a reference answer cannot be checked
 * deterministically, and §56.2 then caps the component's confidence at 0.7 or
 * marks it `unavailable`. Accepting a blank reference answer would quietly
 * reintroduce measured defect 6.
 */
export const transferProblemSchema = z.object({
  problemMarkdown: z.string().min(1).max(5000),
  topic: z.string().max(200).default(''),
  difficulty: z.enum(['easier', 'similar', 'slightly_harder']),
  expectedConcepts: z.array(z.string().max(200)).max(20).default([]),
  internalAnswer: z.string().min(1).max(500),
  internalSolutionSteps: z.array(z.string().max(2000)).max(20).default([]),
  validationNotes: z.array(z.string().max(1000)).max(10).default([]),
});

export type TransferProblem = z.infer<typeof transferProblemSchema>;

/**
 * Problem-image extraction, per section 34.
 *
 * `confidence` is the reason this schema is strict about ranges rather than
 * coercing. It is a policy input: rule R6 blocks tutoring below 0.7, so a model
 * that returns `"0.95"` as a string, or 95 on a 0-100 scale, would sail past the
 * threshold on a value the rule was never given. Out-of-range or wrongly typed
 * confidence is rejected, and the caller then treats extraction as failed rather
 * than assuming it succeeded.
 *
 * `containsPersonalInformation` exists because the prompt instructs the model to
 * skip identifying content it sees. That instruction is unverifiable from the
 * extracted text alone -- text that was correctly omitted leaves no trace -- so
 * the model reports whether it saw any, and the student is warned.
 */
export const problemExtractionSchema = z.object({
  extractedText: z.string().max(5000).default(''),
  containsProblem: z.boolean(),
  confidence: z.number().min(0).max(1),
  detectedLanguage: z.enum(['vi', 'en', 'other']).default('other'),
  subject: z.enum(['mathematics', 'science', 'other']).default('other'),
  extractionWarnings: z.array(z.string().max(500)).max(10).default([]),
  containsStudentWork: z.boolean().default(false),
  containsPersonalInformation: z.boolean().default(false),
});

export type ProblemExtraction = z.infer<typeof problemExtractionSchema>;

/**
 * A model that returns nothing usable must not take the endpoint down, and must
 * not be papered over with an empty object cast to the response type either. The
 * classifier's failure mode is the conservative one: an unrecognised request with
 * no attempt, which routes to the most restrictive policy branches.
 */
export const SAFE_FALLBACK_INTENT: IntentAnalysis = {
  intent: 'unclear',
  subject: 'other',
  topic: null,
  estimatedGradeLevel: null,
  problemStatement: null,
  studentProvidedAttempt: false,
  attemptQuality: 'none',
  answerSeekingLikelihood: 0,
  ambiguityLevel: 'high',
  missingInformation: ['The request could not be analysed.'],
  detectedLanguage: 'en',
  safetyCategory: 'none',
  confidence: 0,
};

export type ParseOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'not_json' | 'schema_mismatch'; detail: string };

function parseJson(raw: string | undefined | null): ParseOutcome<unknown> {
  if (!raw || raw.trim().length === 0) {
    return { ok: false, reason: 'not_json', detail: 'empty model response' };
  }
  try {
    return { ok: true, value: JSON.parse(stripCodeFence(raw)) };
  } catch (error) {
    return {
      ok: false,
      reason: 'not_json',
      detail: error instanceof Error ? error.message : 'unparseable model response',
    };
  }
}

/**
 * Removes a surrounding markdown code fence.
 *
 * Models asked for JSON frequently return it wrapped in ```json ... ```, even
 * when a response schema is supplied, and the wrapper is a presentation
 * artefact rather than a malformed payload. Rejecting it costs the student a
 * turn and produces a 502 for output that was structurally correct.
 *
 * Deliberately narrow: it strips one leading fence and one trailing fence and
 * nothing else. Anything more permissive -- scanning for the first `{`, say --
 * would start accepting prose with an object buried in it, and the point of
 * this layer is that the payload is what the model was asked to produce.
 */
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return raw;

  const withoutOpening = trimmed.replace(/^```[a-zA-Z]*[ \t]*\r?\n?/, '');
  return withoutOpening.replace(/\r?\n?```$/, '');
}

function validate<T>(schema: z.ZodType<T>, raw: string | undefined | null): ParseOutcome<T> {
  const json = parseJson(raw);
  if (!json.ok) return json;

  const result = schema.safeParse(json.value);
  if (!result.success) {
    return {
      ok: false,
      reason: 'schema_mismatch',
      detail: result.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; '),
    };
  }
  return { ok: true, value: result.data };
}

export function parseIntentAnalysis(raw: string | undefined | null): ParseOutcome<IntentAnalysis> {
  return validate(intentAnalysisSchema as unknown as z.ZodType<IntentAnalysis>, raw);
}

export function parseTutorResponse(raw: string | undefined | null): ParseOutcome<TutorResponse> {
  return validate(tutorResponseSchema as unknown as z.ZodType<TutorResponse>, raw);
}

export function parseAttemptEvaluation(
  raw: string | undefined | null,
): ParseOutcome<AttemptEvaluation> {
  return validate(attemptEvaluationSchema as unknown as z.ZodType<AttemptEvaluation>, raw);
}

export function parseTransferProblem(
  raw: string | undefined | null,
): ParseOutcome<TransferProblem> {
  return validate(transferProblemSchema as unknown as z.ZodType<TransferProblem>, raw);
}

export function parseProblemExtraction(
  raw: string | undefined | null,
): ParseOutcome<ProblemExtraction> {
  return validate(problemExtractionSchema as unknown as z.ZodType<ProblemExtraction>, raw);
}

/**
 * When extraction returns nothing usable, confidence is 0, which is below R6's
 * threshold, so the student is asked to confirm or type the problem instead.
 *
 * Failing to a high confidence with empty text would be the worse error: the
 * tutor would begin work on nothing at all, with no confirmation step, and the
 * student would have no idea why. Failing to 0 costs one extra tap.
 */
export const UNAVAILABLE_EXTRACTION: ProblemExtraction = {
  extractedText: '',
  containsProblem: false,
  confidence: 0,
  detectedLanguage: 'other',
  subject: 'other',
  extractionWarnings: ['The text in this image could not be read automatically.'],
  containsStudentWork: false,
  containsPersonalInformation: false,
};

/**
 * When the evaluator returns nothing usable, the honest record is "we do not
 * know", not "the student did nothing".
 *
 * So confidence is 0 and every rubric criterion is false. §56.2 reads a
 * zero-confidence rubric as contributing no weight, which lowers coverage and
 * shows up in the instrumentation-health metric. Defaulting to `true` anywhere
 * here would recreate measured defect 3, where missing telemetry inflated scores.
 */
export const UNAVAILABLE_EVALUATION: AttemptEvaluation = {
  relevance: 0,
  correctness: 0,
  reasoningQuality: 0,
  earliestMeaningfulError: null,
  errorCategory: 'none',
  understands: '',
  missingPrerequisite: null,
  smallestUsefulNextHint: null,
  feedbackSummary: 'This attempt could not be evaluated.',
  confidence: 0,
  reasoningRubric: {
    identifiedMethod: false,
    explainedIntermediateStep: false,
    connectedToConcept: false,
    interpretedResult: false,
    confidence: 0,
    evidenceSpans: [],
  },
  verificationRubric: {
    recomputedOrSubstituted: false,
    checkedUnitsOrPlausibility: false,
    statedAssumptionOrLimitation: false,
    correctlyJudgedContent: false,
    confidence: 0,
  },
  extractedAnswer: null,
};

export type PlanViolation =
  | 'hint_level_above_plan'
  | 'final_answer_forbidden'
  | 'solution_type_forbidden'
  | 'transfer_problem_not_requested';

export interface EnforcementResult {
  response: TutorResponse;
  violations: PlanViolation[];
  /** True when the model's prose was withheld because it exceeded the plan. */
  messageWithheld: boolean;
}

const WITHHELD_MESSAGE_EN =
  'I started to answer with more than you should see at this point, so I have held that ' +
  'back. Tell me what you have tried so far, or which step you are stuck on, and I will ' +
  'help you from there.';

const WITHHELD_MESSAGE_VI =
  'Câu trả lời của tôi vừa rồi đi xa hơn mức bạn nên thấy lúc này, nên tôi đã giữ lại. ' +
  'Hãy cho tôi biết bạn đã thử những gì, hoặc bạn đang mắc ở bước nào, rồi tôi sẽ giúp bạn ' +
  'từ đó.';

/**
 * Enforces the response plan on a generated response.
 *
 * Section 16 says the model must not decide its own permissions, and section 41.1
 * says asking politely is not enforcement. So a response that overshoots is
 * corrected here.
 *
 * The correction withholds the prose rather than only lowering the metadata. A
 * response that reveals the answer has already revealed it in
 * `messageMarkdown`; rewriting `finalAnswerIncluded` to `false` while shipping
 * that text would make the record dishonest and the disclosure would still
 * reach the student. `hintLevel` and `finalAnswerIncluded` are also brought back
 * inside the plan so nothing downstream trusts a value the plan forbade.
 */
export function enforceResponsePlan(
  response: TutorResponse,
  plan: TutorResponsePlan,
  language: 'en' | 'vi' = 'en',
): EnforcementResult {
  const violations: PlanViolation[] = [];

  if (response.hintLevel > plan.allowedHintLevel) {
    violations.push('hint_level_above_plan');
  }
  if (response.finalAnswerIncluded && !plan.mayRevealFinalAnswer) {
    violations.push('final_answer_forbidden');
  }
  if (response.responseType === 'solution' && !plan.mayRevealFinalAnswer) {
    violations.push('solution_type_forbidden');
  }
  if (response.responseType === 'transfer_problem' && !plan.generateTransferProblem) {
    violations.push('transfer_problem_not_requested');
  }

  if (violations.length === 0) {
    return { response, violations, messageWithheld: false };
  }

  // A transfer problem the plan did not ask for is off-plan but discloses
  // nothing, so it is relabelled rather than withheld.
  const disclosing = violations.some((violation) => violation !== 'transfer_problem_not_requested');

  if (!disclosing) {
    return {
      response: { ...response, responseType: 'question' },
      violations,
      messageWithheld: false,
    };
  }

  return {
    response: {
      ...response,
      messageMarkdown: language === 'vi' ? WITHHELD_MESSAGE_VI : WITHHELD_MESSAGE_EN,
      responseType: plan.allowedHintLevel === 0 ? 'question' : 'hint',
      hintLevel: Math.min(response.hintLevel, plan.allowedHintLevel) as TutorResponse['hintLevel'],
      finalAnswerIncluded: false,
      studentActionRequired:
        response.studentActionRequired ?? 'Describe what you have tried so far.',
    },
    violations,
    messageWithheld: true,
  };
}
