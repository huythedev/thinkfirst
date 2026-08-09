import { Schema, Type } from '@google/genai';
import {
  configuredGeminiModel,
  getModelClient,
  modelNameFor,
  resolveModelDriver,
} from '@/lib/ai/model-client';
import {
  isSemanticApproval,
  parseSemanticValidation,
  type SemanticValidation,
} from '@/lib/types/ai/semantic-validation';
import {
  SEMANTIC_VALIDATOR_PROMPT_V1,
  SEMANTIC_VALIDATOR_PROMPT_VERSION,
} from '@/services/ai-gateway/src/prompts/semantic-validator.v1';

export type SemanticValidationKind =
  | 'tutor_response'
  | 'attempt_evaluation'
  | 'image_extraction'
  | 'transfer_answer';

const providerSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    approved: { type: Type.BOOLEAN },
    verdict: {
      type: Type.STRING,
      enum: ['approved', 'rejected', 'correct', 'partial', 'incorrect', 'unable', 'unsupported'],
    },
    confidence: { type: Type.NUMBER },
    issues: { type: Type.ARRAY, items: { type: Type.STRING } },
    correctedValue: { type: Type.STRING, nullable: true },
  },
  required: ['approved', 'verdict', 'confidence', 'issues', 'correctedValue'],
};

export interface SemanticImageInput {
  bytes: Uint8Array;
  mimeType: string;
}

export interface SemanticValidationResult {
  validation: SemanticValidation | null;
  /** False when no structurally valid verifier result was produced. */
  available: boolean;
  /** True when this validation kind produced a usable, sufficiently confident verdict. */
  approved: boolean;
  modelName: string;
  promptVersion: string;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function isUsableValidation(
  kind: SemanticValidationKind,
  validation: SemanticValidation,
  minimumConfidence: number,
): boolean {
  if (kind !== 'transfer_answer') {
    return isSemanticApproval(validation, minimumConfidence);
  }

  return (
    validation.approved &&
    validation.confidence >= minimumConfidence &&
    validation.verdict !== 'approved' &&
    validation.verdict !== 'rejected' &&
    validation.verdict !== 'unsupported'
  );
}

/**
 * The mock driver tests orchestration, not model quality. Return a conservative,
 * structurally valid canned verdict so E2E can exercise the fail-closed branches
 * without spending quota. Production never enters this branch because the model
 * driver refuses `mock` under NODE_ENV=production.
 */
function mockValidation(kind: SemanticValidationKind, input: unknown): SemanticValidation {
  if (kind !== 'transfer_answer') {
    return {
      approved: true,
      verdict: 'approved',
      confidence: 0.95,
      issues: [],
      correctedValue: null,
    };
  }

  const candidate =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)
      : {};
  const deterministicVerdict = candidate['deterministicVerdict'];
  const evaluatorCorrectness = candidate['evaluatorCorrectness'];

  let verdict: SemanticValidation['verdict'] = 'unsupported';
  if (deterministicVerdict === 'equivalent') verdict = 'correct';
  else if (deterministicVerdict === 'not_equivalent') verdict = 'incorrect';
  else if (typeof evaluatorCorrectness === 'number') {
    if (evaluatorCorrectness >= 0.85) verdict = 'correct';
    else if (evaluatorCorrectness >= 0.4) verdict = 'partial';
    else if (evaluatorCorrectness > 0) verdict = 'incorrect';
    else verdict = 'unable';
  }

  return {
    approved: verdict !== 'unsupported',
    verdict,
    confidence: verdict === 'unsupported' ? 0 : 0.9,
    issues: verdict === 'unsupported' ? ['The mock has insufficient evidence to judge this answer.'] : [],
    correctedValue: null,
  };
}

/**
 * Run an independent Gemini semantic verification pass.
 *
 * Provider structured output is followed by our own Zod parse. The verifier is
 * fail-closed: malformed output is unavailable, never an implicit approval.
 * Static verifier instructions are a system instruction; all candidate/model
 * output is serialized inside an explicit data boundary in the user turn so
 * embedded prompt-injection text cannot become an instruction by concatenation.
 */
export async function runSemanticValidation(input: {
  validationKind: SemanticValidationKind;
  data: unknown;
  image?: SemanticImageInput;
  minimumConfidence?: number;
}): Promise<SemanticValidationResult> {
  const validatorModel = configuredGeminiModel('validator');
  const recordedModelName = modelNameFor(validatorModel);
  const minimumConfidence = input.minimumConfidence ?? 0.7;

  if (resolveModelDriver() === 'mock') {
    const validation = mockValidation(input.validationKind, input.data);
    return {
      validation,
      available: true,
      approved: isUsableValidation(input.validationKind, validation, minimumConfidence),
      modelName: recordedModelName,
      promptVersion: SEMANTIC_VALIDATOR_PROMPT_VERSION,
    };
  }

  const payload = JSON.stringify({
    validationKind: input.validationKind,
    data: input.data,
  });

  const parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [
    {
      text: `<validation_input>\n${payload}\n</validation_input>`,
    },
  ];

  if (input.image) {
    parts.push({
      inlineData: {
        mimeType: input.image.mimeType,
        data: toBase64(input.image.bytes),
      },
    });
  }

  try {
    const response = await getModelClient().models.generateContent({
      model: validatorModel,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: SEMANTIC_VALIDATOR_PROMPT_V1,
        responseMimeType: 'application/json',
        responseSchema: providerSchema,
      },
    });

    const parsed = parseSemanticValidation(response.text);
    if (!parsed.ok) {
      console.warn('Semantic validator output rejected by server-side validation:', parsed.detail);
      return {
        validation: null,
        available: false,
        approved: false,
        modelName: recordedModelName,
        promptVersion: SEMANTIC_VALIDATOR_PROMPT_VERSION,
      };
    }

    return {
      validation: parsed.value,
      available: true,
      approved: isUsableValidation(input.validationKind, parsed.value, minimumConfidence),
      modelName: recordedModelName,
      promptVersion: SEMANTIC_VALIDATOR_PROMPT_VERSION,
    };
  } catch (error) {
    console.warn(
      'Semantic validator call failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return {
      validation: null,
      available: false,
      approved: false,
      modelName: recordedModelName,
      promptVersion: SEMANTIC_VALIDATOR_PROMPT_VERSION,
    };
  }
}
