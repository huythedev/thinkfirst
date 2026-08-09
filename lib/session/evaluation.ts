import { Schema, Type } from '@google/genai';
import {
  configuredGeminiModel,
  getModelClient,
  modelNameFor,
} from '@/lib/ai/model-client';
import { runSemanticValidation } from '@/lib/ai/semantic-validation';
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
import type { SemanticValidation } from '@/lib/types/ai/semantic-validation';
import { validateAnswer, type ValidationVerdict } from '@/lib/math/validation';
import type { CorrectnessSource, TransferOutcome } from '@/lib/types/scoring';

/**
 * Attempt evaluation, explanation evaluation, transfer generation and transfer
 * evaluation: the four AI layers Phase 5 lists that Phase 4 did not build.
 *
 * Everything here runs server-side and writes `studentAttempts` under Admin
 * credentials. These evaluations feed the Independence Score, so model output is
 * never trusted from a single generation: provider schemas are followed by Zod,
 * and evaluator evidence is independently checked by the configured Gemini
 * validator before it can become stored scoring evidence.
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

export interface SemanticValidationMetadata {
  available: boolean;
  approved: boolean;
  modelName: string;
  promptVersion: string;
  confidence: number;
}

export interface AttemptEvaluationResult {
  evaluation: AttemptEvaluation;
  available: boolean;
  modelName: string;
  semanticValidation: SemanticValidationMetadata | null;
}

function validationMetadata(input: {
  available: boolean;
  approved: boolean;
  modelName: string;
  promptVersion: string;
  validation: SemanticValidation | null;
}): SemanticValidationMetadata {
  return {
    available: input.available,
    approved: input.approved,
    modelName: input.modelName,
    promptVersion: input.promptVersion,
    confidence: input.validation?.confidence ?? 0,
  };
}

/**
 * Evaluate one student attempt, then independently validate the evaluator's
 * claims before they can become scoring evidence.
 */
export async function evaluateAttempt(context: EvaluationContext): Promise<AttemptEvaluationResult> {
  const configuredModel = configuredGeminiModel('evaluator');
  const recordedModelName = modelNameFor(configuredModel);

  const prompt =
    `Problem: ${context.problem}\n` +
    `Learning objective: ${context.learningObjective ?? 'not stated'}\n` +
    `Student grade: ${context.grade}\n` +
    `Transcript:\n${context.transcript}\n` +
    `Latest student message: ${context.studentMessage}`;

  try {
    const response = await getModelClient().models.generateContent({
      model: configuredModel,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: EVALUATOR_PROMPT_V1,
        responseMimeType: 'application/json',
        responseSchema: evaluationSchema,
      },
    });

    const parsed = parseAttemptEvaluation(response.text);
    if (!parsed.ok) {
      console.warn('Evaluator output rejected by server-side validation:', parsed.detail);
      return {
        evaluation: UNAVAILABLE_EVALUATION,
        available: false,
        modelName: recordedModelName,
        semanticValidation: null,
      };
    }

    const semantic = await runSemanticValidation({
      validationKind: 'attempt_evaluation',
      data: {
        problem: context.problem,
        learningObjective: context.learningObjective,
        grade: context.grade,
        transcript: context.transcript,
        studentMessage: context.studentMessage,
        candidateEvaluation: parsed.value,
      },
    });
    const metadata = validationMetadata(semantic);

    if (!semantic.approved) {
      console.warn(
        'Evaluator judgement rejected by independent semantic validation:',
        semantic.validation?.issues.join('; ') || 'validator unavailable or did not approve',
      );
      return {
        evaluation: UNAVAILABLE_EVALUATION,
        available: false,
        modelName: recordedModelName,
        semanticValidation: metadata,
      };
    }

    return {
      evaluation: parsed.value,
      available: true,
      modelName: recordedModelName,
      semanticValidation: metadata,
    };
  } catch (error) {
    console.warn(
      'Evaluator or evaluator-validation call failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return {
      evaluation: UNAVAILABLE_EVALUATION,
      available: false,
      modelName: recordedModelName,
      semanticValidation: null,
    };
  }
}

export interface GeneratedTransferProblem {
  problem: TransferProblem;
  validated: true;
  modelName: string;
  validation: SemanticValidationMetadata;
}

/**
 * Generate a transfer problem and validate it independently before it can be
 * issued. The deterministic final-step check is retained as a useful signal, but
 * self-consistency is not approval: a different Gemini validation pass must
 * independently establish problem/answer/steps/units/concept consistency.
 */
export async function generateTransferProblem(context: {
  problem: string;
  topic: string | null;
  grade: number;
  conceptTags: string[];
}): Promise<GeneratedTransferProblem | null> {
  const configuredModel = configuredGeminiModel('transfer');
  const validatorModel = configuredGeminiModel('validator');
  const recordedModelName = modelNameFor(configuredModel);
  const recordedValidatorModelName = modelNameFor(validatorModel);

  const prompt =
    `Completed problem: ${context.problem}\n` +
    `Topic: ${context.topic ?? 'unspecified'}\n` +
    `Student grade: ${context.grade}\n` +
    `Concepts just practised: ${context.conceptTags.join(', ') || 'unspecified'}`;

  try {
    const response = await getModelClient().models.generateContent({
      model: configuredModel,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: TRANSFER_PROMPT_V1,
        responseMimeType: 'application/json',
        responseSchema: transferSchema,
      },
    });

    const parsed = parseTransferProblem(response.text);
    if (!parsed.ok) {
      console.warn('Transfer output rejected by server-side validation:', parsed.detail);
      return null;
    }

    const lastStep = parsed.value.internalSolutionSteps.at(-1);
    const deterministicVerdict: ValidationVerdict =
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
              text: `<validation_input>\n${JSON.stringify(validatorInput)}\n</validation_input>`,
            },
          ],
        },
      ],
      config: {
        systemInstruction: VALIDATOR_PROMPT_V1,
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

    const problem: TransferProblem = {
      ...parsed.value,
      validationNotes: [
        ...parsed.value.validationNotes,
        `Independent validation: ${VALIDATOR_PROMPT_VERSION}; model=${recordedValidatorModelName}; ` +
          `confidence=${validation.value.confidence.toFixed(2)}; ` +
          `deterministicFinalStep=${deterministicVerdict}`,
      ],
    };

    return {
      problem,
      validated: true,
      modelName: recordedModelName,
      validation: {
        available: true,
        approved: true,
        modelName: recordedValidatorModelName,
        promptVersion: VALIDATOR_PROMPT_VERSION,
        confidence: validation.value.confidence,
      },
    };
  } catch (error) {
    console.warn(
      'Transfer generation or validation failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return null;
  }
}

export interface TransferOutcomeResult {
  outcome: TransferOutcome | null;
  correctnessSource: CorrectnessSource;
  confidence: number;
}

function correctTransferOutcome(hintDelta: number): TransferOutcome {
  if (hintDelta <= 0) return 'independent_correct';
  if (hintDelta === 1) return 'minor_prompt';
  return 'one_conceptual_hint';
}

/** Pure deterministic/evaluator fallback retained for scoring tests and local signal use. */
export function resolveTransferOutcome(input: {
  studentAnswer: string | null;
  referenceAnswer: string | null;
  evaluatorCorrectness: number | null;
  hintDelta: number;
}): TransferOutcomeResult {
  const { studentAnswer, referenceAnswer, evaluatorCorrectness, hintDelta } = input;

  if (studentAnswer && referenceAnswer) {
    const result = validateAnswer(studentAnswer, referenceAnswer);
    if (result.verdict === 'equivalent') {
      return {
        outcome: correctTransferOutcome(hintDelta),
        correctnessSource: 'deterministic',
        confidence: 1,
      };
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
      return {
        outcome: correctTransferOutcome(hintDelta),
        correctnessSource: 'evaluator',
        confidence: 0.7,
      };
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

export interface ValidatedTransferOutcome extends TransferOutcomeResult {
  semanticValidation: SemanticValidationMetadata;
}

/**
 * Load-bearing transfer correctness is Gemini-first for now. The local checker
 * remains a signal, but a deterministic verdict reaches confidence 1.0 only when
 * an independent Gemini verifier agrees exactly. A disagreement or an unable
 * verifier is unavailable rather than a confident student penalty.
 *
 * When the local checker cannot decide, the independent Gemini validator is the
 * model-based path required by §56.2 and remains capped at confidence 0.7.
 */
export async function validateTransferOutcome(input: {
  problemMarkdown: string;
  studentAnswer: string | null;
  referenceAnswer: string | null;
  evaluatorCorrectness: number | null;
  hintDelta: number;
}): Promise<ValidatedTransferOutcome> {
  const { problemMarkdown, studentAnswer, referenceAnswer, evaluatorCorrectness, hintDelta } = input;

  const deterministicVerdict: ValidationVerdict =
    studentAnswer && referenceAnswer
      ? validateAnswer(studentAnswer, referenceAnswer).verdict
      : 'unsupported';

  const semantic = await runSemanticValidation({
    validationKind: 'transfer_answer',
    data: {
      problemMarkdown,
      studentAnswer,
      referenceAnswer,
      evaluatorCorrectness,
      deterministicVerdict,
    },
  });
  const metadata = validationMetadata(semantic);
  const judgement = semantic.validation;

  if (
    !semantic.available ||
    !judgement ||
    !judgement.approved ||
    judgement.confidence < 0.7 ||
    judgement.verdict === 'unsupported' ||
    judgement.verdict === 'rejected' ||
    judgement.verdict === 'approved'
  ) {
    return {
      outcome: null,
      correctnessSource: 'unavailable',
      confidence: 0,
      semanticValidation: metadata,
    };
  }

  if (deterministicVerdict === 'equivalent') {
    if (judgement.verdict !== 'correct') {
      return {
        outcome: null,
        correctnessSource: 'unavailable',
        confidence: 0,
        semanticValidation: metadata,
      };
    }
    return {
      outcome: correctTransferOutcome(hintDelta),
      correctnessSource: 'deterministic',
      confidence: 1,
      semanticValidation: metadata,
    };
  }

  if (deterministicVerdict === 'not_equivalent') {
    if (judgement.verdict !== 'incorrect') {
      return {
        outcome: null,
        correctnessSource: 'unavailable',
        confidence: 0,
        semanticValidation: metadata,
      };
    }
    return {
      outcome: 'attempted_incorrect',
      correctnessSource: 'deterministic',
      confidence: 1,
      semanticValidation: metadata,
    };
  }

  const modelConfidence = Math.min(0.7, judgement.confidence);
  switch (judgement.verdict) {
    case 'correct':
      return {
        outcome: correctTransferOutcome(hintDelta),
        correctnessSource: 'validator',
        confidence: modelConfidence,
        semanticValidation: metadata,
      };
    case 'partial':
      return {
        outcome: 'partial',
        correctnessSource: 'validator',
        confidence: modelConfidence,
        semanticValidation: metadata,
      };
    case 'incorrect':
      return {
        outcome: 'attempted_incorrect',
        correctnessSource: 'validator',
        confidence: modelConfidence,
        semanticValidation: metadata,
      };
    case 'unable':
      return {
        outcome: 'unable_to_begin',
        correctnessSource: 'validator',
        confidence: modelConfidence,
        semanticValidation: metadata,
      };
    default:
      return {
        outcome: null,
        correctnessSource: 'unavailable',
        confidence: 0,
        semanticValidation: metadata,
      };
  }
}

interface TransferAttemptPersistence {
  problemId: string;
  outcome: TransferOutcome | null;
  correctnessSource: CorrectnessSource;
  confidence: number;
  studentAnswer: string | null;
  semanticValidation?: SemanticValidationMetadata | null;
}

function attemptDocument(input: {
  id: string;
  sessionId: string;
  studentId: string;
  attemptText: string;
  attemptType: AttemptType;
  evaluation: AttemptEvaluation;
  available: boolean;
  modelName: string;
  semanticValidation?: SemanticValidationMetadata | null;
  transfer?: TransferAttemptPersistence;
}) {
  return {
    id: input.id,
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
      semanticValidation: input.semanticValidation ?? null,
      ...(input.transfer
        ? {
            transferOutcome: input.transfer.outcome,
            correctnessSource: input.transfer.correctnessSource,
            correctnessConfidence: input.transfer.confidence,
            // Never copy the hidden reference answer into this client-readable
            // collection. It stays exclusively in `transferProblems`.
            studentAnswer: input.transfer.studentAnswer,
            transferSemanticValidation: input.transfer.semanticValidation ?? null,
          }
        : {}),
    },
    evaluatorPromptVersion: EVALUATOR_PROMPT_VERSION,
    transferPromptVersion: TRANSFER_PROMPT_VERSION,
    modelName: input.modelName,
    createdAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Persist one evaluation under Admin credentials.
 *
 * Transfer evaluations use a deterministic id and atomically mark the hidden
 * transfer problem evaluated in the same batch. A retry can overwrite the same
 * evidence document but cannot create duplicate scoring evidence or leave a
 * successful attempt attached to a still-pending transfer.
 */
export async function recordAttemptEvaluation(input: {
  sessionId: string;
  studentId: string;
  attemptText: string;
  attemptType: AttemptType;
  evaluation: AttemptEvaluation;
  available: boolean;
  modelName: string;
  semanticValidation?: SemanticValidationMetadata | null;
  transfer?: TransferAttemptPersistence;
}): Promise<string> {
  const attemptId = input.transfer
    ? `${input.transfer.problemId}__evaluation`
    : adminDb.collection('studentAttempts').doc().id;
  const ref = adminDb.collection('studentAttempts').doc(attemptId);
  const data = attemptDocument({ ...input, id: attemptId });

  if (!input.transfer) {
    await ref.set(data);
    return ref.id;
  }

  const transferRef = adminDb.collection('transferProblems').doc(input.transfer.problemId);
  const batch = adminDb.batch();
  batch.set(ref, data);
  batch.update(transferRef, {
    status: 'evaluated',
    evaluatedAt: FieldValue.serverTimestamp(),
    answerSemanticValidation: input.transfer.semanticValidation ?? null,
  });
  await batch.commit();

  return ref.id;
}
