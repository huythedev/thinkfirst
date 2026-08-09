import { Schema, Type } from '@google/genai';
import { getModelClient } from '@/lib/ai/model-client';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import {
  AttemptEvaluation,
  UNAVAILABLE_EVALUATION,
  parseAttemptEvaluation,
  parseTransferProblem,
  TransferProblem,
} from '@/lib/types/ai/model-output';
import {
  EVALUATOR_PROMPT_V1,
  EVALUATOR_PROMPT_VERSION,
} from '@/services/ai-gateway/src/prompts/evaluator.v1';
import {
  TRANSFER_PROMPT_V1,
  TRANSFER_PROMPT_VERSION,
} from '@/services/ai-gateway/src/prompts/transfer.v1';
import {
  VALIDATOR_PROMPT_V1,
  VALIDATOR_PROMPT_VERSION,
} from '@/services/ai-gateway/src/prompts/validator.v1';
import {
  isTransferValidationApproved,
  parseTransferValidation,
} from '@/lib/types/ai/transfer-validation';
import { validateAnswer } from '@/lib/math/validation';
import { TransferOutcome } from '@/lib/types/scoring';

/**
 * Attempt evaluation, explanation evaluation, transfer generation and transfer
 * evaluation: the four AI layers Phase 5 lists that Phase 4 did not build.
 *
 * Everything here runs server-side and writes `studentAttempts` under Admin
 * credentials. That is not incidental. These evaluations feed the Independence
 * Score, and §56.4 forbids the client writing a score; a client that could author
 * its own rubric judgments could author its own score by proxy, which is the same
 * exploit class as the forged `strictness` that Phase 4 closed. The security rule
 * for `studentAttempts` was tightened in the same session for this reason.
 */

const rubricProperties = {
  identifiedMethod: { type: Type.BOOLEAN },
  explainedIntermediateStep: { type: Type.BOOLEAN },
  connectedToConcept: { type: Type.BOOLEAN },
  interpretedResult: { type: Type.BOOLEAN },
  confidence: { type: Type.NUMBER },
  evidenceSpans: { type: Type.ARRAY, items: { type: Type.STRING } },
};

const verificationProperties = {
  recomputedOrSubstituted: { type: Type.BOOLEAN },
  checkedUnitsOrPlausibility: { type: Type.BOOLEAN },
  statedAssumptionOrLimitation: { type: Type.BOOLEAN },
  correctlyJudgedContent: { type: Type.BOOLEAN },
  confidence: { type: Type.NUMBER },
};

const evaluationSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    relevance: { type: Type.NUMBER },
    correctness: { type: Type.NUMBER },
    reasoningQuality: { type: Type.NUMBER },
    earliestMeaningfulError: { type: Type.STRING, nullable: true },
    errorCategory: {
      type: Type.STRING,
      enum: [
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
      ],
    },
    understands: { type: Type.STRING },
    missingPrerequisite: { type: Type.STRING, nullable: true },
    smallestUsefulNextHint: { type: Type.STRING, nullable: true },
    feedbackSummary: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
    reasoningRubric: {
      type: Type.OBJECT,
      properties: rubricProperties,
      required: [
        'identifiedMethod',
        'explainedIntermediateStep',
        'connectedToConcept',
        'interpretedResult',
        'confidence',
      ],
    },
    verificationRubric: {
      type: Type.OBJECT,
      properties: verificationProperties,
      required: [
        'recomputedOrSubstituted',
        'checkedUnitsOrPlausibility',
        'statedAssumptionOrLimitation',
        'correctlyJudgedContent',
        'confidence',
      ],
    },
    extractedAnswer: { type: Type.STRING, nullable: true },
  },
  required: [
    'relevance',
    'correctness',
    'reasoningQuality',
    'errorCategory',
    'confidence',
    'reasoningRubric',
    'verificationRubric',
  ],
};

const transferSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    problemMarkdown: { type: Type.STRING },
    topic: { type: Type.STRING },
    difficulty: { type: Type.STRING, enum: ['easier', 'similar', 'slightly_harder'] },
    expectedConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
    internalAnswer: { type: Type.STRING },
    internalSolutionSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
    validationNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['problemMarkdown', 'difficulty', 'internalAnswer'],
};

const transferValidatorSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    valid: { type: Type.BOOLEAN },
    answerCorrect: { type: Type.BOOLEAN },
    stepsConsistent: { type: Type.BOOLEAN },
    problemUnambiguous: { type: Type.BOOLEAN },
    unitsCorrect: { type: Type.BOOLEAN },
    sameConcept: { type: Type.BOOLEAN },
    correctedAnswer: { type: Type.STRING, nullable: true },
    confidence: { type: Type.NUMBER },
    issues: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [
    'valid',
    'answerCorrect',
    'stepsConsistent',
    'problemUnambiguous',
    'unitsCorrect',
    'sameConcept',
    'correctedAnswer',
    'confidence',
    'issues',
  ],
};

export type AttemptType = 'initial' | 'intermediate' | 'explanation' | 'transfer' | 'verification';

export interface EvaluationContext {
  problem: string;
  learningObjective: string | null;
  transcript: string;
  studentMessage: string;
  grade: number;
}

/**
 * Evaluates one student attempt. Revalidated server-side after generation, per
 * the same rule the classifier and tutor follow: provider-side `responseSchema`
 * is a hint, not a guarantee.
 *
 * A model that returns nothing usable yields `UNAVAILABLE_EVALUATION`, whose
 * confidence is 0. That reduces coverage and shows up in the instrumentation
 * metric rather than being scored as though the student did nothing, which is
 * measured defect 3.
 */
export async function evaluateAttempt(
  context: EvaluationContext,
): Promise<{ evaluation: AttemptEvaluation; available: boolean; modelName: string }> {
  const modelName = process.env.GEMINI_EVALUATOR_MODEL || 'gemini-3.6-flash';

  const prompt =
    `Problem: ${context.problem}\n` +
    `Learning objective: ${context.learningObjective ?? 'not stated'}\n` +
    `Student grade: ${context.grade}\n` +
    `Transcript:\n${context.transcript}\n` +
    `Latest student message: ${context.studentMessage}`;

  try {
    const response = await getModelClient().models.generateContent({
      model: modelName,
      contents: [{ role: 'user', parts: [{ text: EVALUATOR_PROMPT_V1 + '\n\n' + prompt }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: evaluationSchema,
        temperature: 0.1,
      },
    });

    const parsed = parseAttemptEvaluation(response.text);
    if (!parsed.ok) {
      console.warn('Evaluator output rejected by server-side validation:', parsed.detail);
      return { evaluation: UNAVAILABLE_EVALUATION, available: false, modelName };
    }

    return { evaluation: parsed.value, available: true, modelName };
  } catch (error) {
    // A failed evaluation must never fail the tutoring turn. The student still
    // gets their response; the score records that this observation is missing.
    console.warn(
      'Evaluator call failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return { evaluation: UNAVAILABLE_EVALUATION, available: false, modelName };
  }
}

/**
 * Generates a transfer problem and validates it independently before it can be
 * issued. The cheap deterministic final-step check is retained as a signal, but
 * it is not sufficient: self-consistency between a generator's last step and its
 * own answer does not prove that the natural-language problem actually has that
 * answer. Gemini validator approval is therefore the load-bearing second pass.
 *
 * Fail closed: malformed validator output, a rejected problem, or confidence
 * below the approval threshold returns null. The caller already treats a missing
 * transfer as missing evidence rather than failing the student's tutoring turn.
 */
export async function generateTransferProblem(context: {
  problem: string;
  topic: string | null;
  grade: number;
  conceptTags: string[];
}): Promise<{ problem: TransferProblem; validated: boolean; modelName: string } | null> {
  const modelName = process.env.GEMINI_TRANSFER_MODEL || 'gemini-3.6-flash';
  const validatorModel = process.env.GEMINI_VALIDATOR_MODEL || 'gemini-3.6-flash';

  const prompt =
    `Completed problem: ${context.problem}\n` +
    `Topic: ${context.topic ?? 'unspecified'}\n` +
    `Student grade: ${context.grade}\n` +
    `Concepts just practised: ${context.conceptTags.join(', ') || 'unspecified'}`;

  try {
    const response = await getModelClient().models.generateContent({
      model: modelName,
      contents: [{ role: 'user', parts: [{ text: TRANSFER_PROMPT_V1 + '\n\n' + prompt }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: transferSchema,
        temperature: 0.6,
      },
    });

    const parsed = parseTransferProblem(response.text);
    if (!parsed.ok) {
      console.warn('Transfer output rejected by server-side validation:', parsed.detail);
      return null;
    }

    const lastStep = parsed.value.internalSolutionSteps.at(-1);
    const deterministicVerdict =
      lastStep === undefined
        ? 'unsupported'
        : validateAnswer(lastStep, parsed.value.internalAnswer).verdict;

    const validatorInput = {
      intendedContext: {
        completedProblem: context.problem,
        topic: context.topic,
        grade: context.grade,
        conceptTags: context.conceptTags,
      },
      generatedTransfer: parsed.value,
      deterministicFinalStepCheck: deterministicVerdict,
    };

    const validationResponse = await getModelClient().models.generateContent({
      model: validatorModel,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                VALIDATOR_PROMPT_V1 +
                '\n\nInput to validate:\n' +
                JSON.stringify(validatorInput),
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: transferValidatorSchema,
      },
    });

    const validation = parseTransferValidation(validationResponse.text);
    if (!validation.ok) {
      console.warn('Transfer validator output rejected by server-side validation:', validation.detail);
      return null;
    }

    if (!isTransferValidationApproved(validation.value)) {
      console.warn(
        'Transfer problem rejected by independent validator:',
        validation.value.issues.join('; ') || 'validator did not approve',
      );
      return null;
    }

    // validationNotes are internal and never shown to the student. Recording the
    // validating model/version here preserves provenance without widening the
    // route or exposing the hidden reference answer.
    const problem: TransferProblem = {
      ...parsed.value,
      validationNotes: [
        ...parsed.value.validationNotes,
        `Independent validation: ${VALIDATOR_PROMPT_VERSION}; model=${validatorModel}; ` +
          `confidence=${validation.value.confidence.toFixed(2)}; ` +
          `deterministicFinalStep=${deterministicVerdict}`,
      ],
    };

    return { problem, validated: true, modelName };
  } catch (error) {
    console.warn(
      'Transfer generation or validation failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return null;
  }
}

/**
 * Establishes the transfer outcome, in the precedence §56.2 sets:
 *
 *   1. deterministic check against the stored reference answer  -> confidence 1.0
 *   2. evaluator judgment                                       -> capped at 0.7
 *   3. neither                                                  -> `unavailable`
 *
 * Correctness is decided *before* fluency is considered. Under v1, fluency alone
 * mapped a wrong answer to `independent_correct` and the full 30 points, which is
 * measured defect 6. So the hint delta below only chooses *among* correct
 * outcomes; it can never turn an incorrect answer into a correct one.
 */
export function resolveTransferOutcome(input: {
  studentAnswer: string | null;
  referenceAnswer: string | null;
  evaluatorCorrectness: number | null;
  hintDelta: number;
}): {
  outcome: TransferOutcome | null;
  correctnessSource: 'deterministic' | 'evaluator' | 'unavailable';
  confidence: number;
} {
  const { studentAnswer, referenceAnswer, evaluatorCorrectness, hintDelta } = input;

  const correctOutcome = (): TransferOutcome => {
    if (hintDelta <= 0) return 'independent_correct';
    if (hintDelta === 1) return 'minor_prompt';
    return 'one_conceptual_hint';
  };

  if (studentAnswer && referenceAnswer) {
    const result = validateAnswer(studentAnswer, referenceAnswer);
    if (result.verdict === 'equivalent') {
      return { outcome: correctOutcome(), correctnessSource: 'deterministic', confidence: 1 };
    }
    if (result.verdict === 'not_equivalent') {
      return {
        outcome: 'attempted_incorrect',
        correctnessSource: 'deterministic',
        confidence: 1,
      };
    }
  }

  if (typeof evaluatorCorrectness === 'number') {
    if (evaluatorCorrectness >= 0.85) {
      return { outcome: correctOutcome(), correctnessSource: 'evaluator', confidence: 0.7 };
    }
    if (evaluatorCorrectness >= 0.4) {
      return { outcome: 'partial', correctnessSource: 'evaluator', confidence: 0.7 };
    }
    if (evaluatorCorrectness > 0) {
      return {
        outcome: 'attempted_incorrect',
        correctnessSource: 'evaluator',
        confidence: 0.7,
      };
    }
    return { outcome: 'unable_to_begin', correctnessSource: 'evaluator', confidence: 0.7 };
  }

  return { outcome: null, correctnessSource: 'unavailable', confidence: 0 };
}

/**
 * Persists one evaluation to `studentAttempts` under Admin credentials.
 *
 * The document carries both rubrics so `deriveSessionMetrics` can read stored
 * judgments instead of re-requesting them, which is what makes recomputation
 * deterministic per §56.4.
 */
export async function recordAttemptEvaluation(input: {
  sessionId: string;
  studentId: string;
  attemptText: string;
  attemptType: AttemptType;
  evaluation: AttemptEvaluation;
  available: boolean;
  modelName: string;
  transfer?: {
    outcome: TransferOutcome | null;
    correctnessSource: 'deterministic' | 'evaluator' | 'unavailable';
    confidence: number;
    referenceAnswer: string | null;
    studentAnswer: string | null;
  };
}): Promise<string> {
  const ref = adminDb.collection('studentAttempts').doc();

  await ref.set({
    id: ref.id,
    sessionId: input.sessionId,
    studentId: input.studentId,
    attemptText: input.attemptText.slice(0, 20000),
    attemptType: input.attemptType,
    evaluation: {
      relevance: input.evaluation.relevance,
      correctness: input.evaluation.correctness,
      reasoningQuality: input.evaluation.reasoningQuality,
      errorCategory: input.evaluation.errorCategory,
      feedbackSummary: input.evaluation.feedbackSummary,
      earliestMeaningfulError: input.evaluation.earliestMeaningfulError,
      missingPrerequisite: input.evaluation.missingPrerequisite,
      smallestUsefulNextHint: input.evaluation.smallestUsefulNextHint,
      confidence: input.evaluation.confidence,
      reasoningRubric: input.evaluation.reasoningRubric,
      verificationRubric: input.evaluation.verificationRubric,
      extractedAnswer: input.evaluation.extractedAnswer,
      evaluationAvailable: input.available,
      ...(input.transfer
        ? {
            transferOutcome: input.transfer.outcome,
            correctnessSource: input.transfer.correctnessSource,
            correctnessConfidence: input.transfer.confidence,
            referenceAnswer: input.transfer.referenceAnswer,
            studentAnswer: input.transfer.studentAnswer,
          }
        : {}),
    },
    evaluatorPromptVersion: EVALUATOR_PROMPT_VERSION,
    transferPromptVersion: TRANSFER_PROMPT_VERSION,
    modelName: input.modelName,
    createdAt: FieldValue.serverTimestamp(),
  });

  return ref.id;
}
