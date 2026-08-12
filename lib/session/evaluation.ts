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
import { validateAnswer } from '@/lib/math/validation';
import { TransferOutcome } from '@/lib/types/scoring';
import { runWhileSessionActive } from '@/lib/session/active-session';
import { studentVisibleTransferText } from '@/lib/ai/output-boundaries';
import {
  judgeSemanticDisclosure,
  validateSemanticDisclosure,
} from '@/lib/ai/disclosure-validation';

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
 * Generates a transfer problem, then runs the second validation pass section 22
 * requires: the model's own `internalAnswer` is checked against its own worked
 * steps where that is deterministically possible.
 */
export async function generateTransferProblem(context: {
  problem: string;
  topic: string | null;
  grade: number;
  conceptTags: string[];
  subject?: string;
  /** Original answer, if trusted and not currently disclosable. */
  protectedOriginalAnswer?: string | null;
  originalFinalAnswerAllowed?: boolean;
}): Promise<{ problem: TransferProblem; validated: boolean; modelName: string } | null> {
  const modelName = process.env.GEMINI_TRANSFER_MODEL || 'gemini-3.6-flash';

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

    // Section 22's second pass. A reference answer that the last worked step
    // contradicts is not usable as a deterministic checker, so it is recorded as
    // unvalidated rather than trusted.
    const lastStep = parsed.value.internalSolutionSteps.at(-1);
    const validated =
      lastStep === undefined
        ? false
        : validateAnswer(lastStep, parsed.value.internalAnswer).verdict === 'equivalent';

    let finalValidated = validated;
    if (!validated) {
      const validatorSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          isValid: { type: Type.BOOLEAN },
          reasoning: { type: Type.STRING },
        },
        required: ['isValid', 'reasoning'],
      };
      const validationPrompt = `You are an independent transfer problem validator.
Check if the generated problem is solvable, unambiguous, tests the intended concept, has appropriate difficulty, and the internalAnswer answers the generated problem based on the internalSolutionSteps.

Generated Problem: ${parsed.value.problemMarkdown}
Internal Answer: ${parsed.value.internalAnswer}
Internal Solution Steps: ${parsed.value.internalSolutionSteps.join('\n')}
Expected Topic: ${context.topic ?? 'unspecified'}
Expected Grade: ${context.grade}`;

      try {
        const valResponse = await getModelClient().models.generateContent({
          model: process.env.GEMINI_TRANSFER_MODEL || 'gemini-3.6-flash',
          contents: [{ role: 'user', parts: [{ text: validationPrompt }] }],
          config: {
            responseMimeType: 'application/json',
            responseSchema: validatorSchema,
            temperature: 0.1,
          },
        });
        const valResult = JSON.parse(valResponse.text || '{}');
        if (valResult && valResult.isValid === true) {
          finalValidated = true;
        }
      } catch (e) {
        console.warn('Gemini transfer validation failed:', e);
      }
    }

    if (!finalValidated) {
      console.warn('Transfer generation rejected by Gemini validator.');
      return null;
    }

    // The transfer generator is an untrusted text producer too. Check every
    // student-visible field against its own answer, and then against the source
    // problem's protected answer when the source answer is still forbidden.
    if (!(await isSafeTransferForStudent(parsed.value, context))) {
      console.warn('Transfer generation rejected by disclosure validation.');
      return null;
    }

    return { problem: parsed.value, validated: finalValidated, modelName };
  } catch (error) {
    console.warn(
      'Transfer generation failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return null;
  }
}

async function isSafeTransferForStudent(
  problem: TransferProblem,
  context: {
    problem: string;
    subject?: string;
    protectedOriginalAnswer?: string | null;
    originalFinalAnswerAllowed?: boolean;
  },
): Promise<boolean> {
  const visible = studentVisibleTransferText(problem);
  const subject = context.subject ?? 'mathematics';
  const references = [
    { answer: problem.internalAnswer, sourceProblem: problem.problemMarkdown },
    ...(context.originalFinalAnswerAllowed || !context.protectedOriginalAnswer
      ? []
      : [{ answer: context.protectedOriginalAnswer, sourceProblem: context.problem }]),
  ];

  const unavailableReferences: typeof references = [];
  // Complete every deterministic check before consulting the model. That gives
  // a protected-original-answer leak the same final authority as an own-answer
  // leak even if a previous reference happened to be unsupported.
  for (const reference of references) {
    const deterministic = validateSemanticDisclosure({
      messageMarkdown: visible,
      referenceAnswer: reference.answer,
      subject,
      fullSolutionAllowedThisTurn: false,
    });
    // Deterministic leakage is final. A generative judge is only a strict
    // fallback for syntax the deterministic validator cannot support; it is
    // never an appeal that can upgrade a known leak to safe.
    if (deterministic.verdict === 'leak') return false;
    if (deterministic.verdict === 'safe') continue;

    unavailableReferences.push(reference);
  }

  for (const reference of unavailableReferences) {
    // Unsupported deterministic parsing must not become permission. The strict
    // judge is shared with tutor disclosure and maps malformed/low-confidence/
    // unavailable outcomes to unsafe.
    const judged = await judgeSemanticDisclosure({
      problem: reference.sourceProblem,
      referenceAnswer: reference.answer,
      candidateResponse: visible,
      responsePlan: {
        action: 'transfer_problem',
        allowedHintLevel: 0,
        mayRevealFinalAnswer: false,
      },
    });
    if (judged.verdict !== 'safe') return false;
  }
  return true;
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
  /** Route commits use an atomic active-session precondition; maintenance does not. */
  requireActiveSession?: boolean;
  transfer?: {
    outcome: TransferOutcome | null;
    correctnessSource: 'deterministic' | 'evaluator' | 'unavailable';
    confidence: number;
    studentAnswer: string | null;
  };
}): Promise<string> {
  const ref = adminDb.collection('studentAttempts').doc();

  const attempt = {
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
            studentAnswer: input.transfer.studentAnswer,
          }
        : {}),
    },
    evaluatorPromptVersion: EVALUATOR_PROMPT_VERSION,
    transferPromptVersion: TRANSFER_PROMPT_VERSION,
    modelName: input.modelName,
    createdAt: FieldValue.serverTimestamp(),
  };

  if (input.requireActiveSession) {
    await runWhileSessionActive(input.sessionId, (transaction) => {
      transaction.set(ref, attempt);
    });
  } else {
    await ref.set(attempt);
  }

  return ref.id;
}
