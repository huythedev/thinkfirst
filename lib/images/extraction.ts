import { Schema, Type } from '@google/genai';
import {
  configuredGeminiModel,
  getModelClient,
  modelNameFor,
} from '@/lib/ai/model-client';
import { runSemanticValidation } from '@/lib/ai/semantic-validation';
import {
  EXTRACTION_PROMPT_V1,
  EXTRACTION_PROMPT_VERSION,
} from '@/services/ai-gateway/src/prompts/extraction.v1';
import {
  UNAVAILABLE_EXTRACTION,
  parseProblemExtraction,
  type ProblemExtraction,
} from '@/lib/types/ai/model-output';
import type { ImageFormat } from '@/lib/images/validation';

/**
 * Multimodal extraction of a problem from an uploaded image, per section 34
 * steps 6 to 8.
 *
 * The image bytes reach the model from server memory, immediately after
 * validation and before anything is stored, so extraction never runs on an
 * object that failed a check. Section 35 forbids logging raw image bytes, so
 * nothing here writes them to a log on any path, including the error paths.
 */

const extractionSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    extractedText: { type: Type.STRING },
    containsProblem: { type: Type.BOOLEAN },
    confidence: { type: Type.NUMBER },
    detectedLanguage: { type: Type.STRING, enum: ['vi', 'en', 'other'] },
    subject: { type: Type.STRING, enum: ['mathematics', 'science', 'other'] },
    extractionWarnings: { type: Type.ARRAY, items: { type: Type.STRING } },
    containsStudentWork: { type: Type.BOOLEAN },
    containsPersonalInformation: { type: Type.BOOLEAN },
  },
  required: ['extractedText', 'containsProblem', 'confidence', 'extractionWarnings'],
};

export interface ExtractionResult {
  extraction: ProblemExtraction;
  /** False when the extractor model failed or returned something the schema rejected. */
  available: boolean;
  modelName: string;
  latencyMs: number;
  semanticValidation: {
    available: boolean;
    approved: boolean;
    modelName: string;
    promptVersion: string;
    confidence: number;
  } | null;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function unavailableResult(modelName: string, startedAt: number): ExtractionResult {
  return {
    extraction: UNAVAILABLE_EXTRACTION,
    available: false,
    modelName,
    latencyMs: Date.now() - startedAt,
    semanticValidation: null,
  };
}

/**
 * Runs extraction, then independently verifies a non-empty candidate against the
 * same image with Gemini before its confidence is allowed to bypass student
 * confirmation.
 *
 * A failed semantic verifier does not discard the candidate text. It forces
 * confidence to 0, which routes the student through the existing confirmation
 * UI. That is safer than silently replacing OCR text with a second model's guess,
 * and it preserves the student's ability to correct the image extraction.
 */
export async function extractProblemFromImage(
  bytes: Uint8Array,
  format: ImageFormat,
  context?: { grade?: number; language?: 'en' | 'vi' },
): Promise<ExtractionResult> {
  const configuredModel = configuredGeminiModel('extraction');
  const recordedModelName = modelNameFor(configuredModel);
  const startedAt = Date.now();

  const hint =
    `Student grade: ${context?.grade ?? 'unknown'}. ` +
    `Expected language: ${context?.language ?? 'unknown'}.`;

  try {
    const response = await getModelClient().models.generateContent({
      model: configuredModel,
      contents: [
        {
          role: 'user',
          parts: [
            { text: hint },
            { inlineData: { mimeType: format, data: toBase64(bytes) } },
          ],
        },
      ],
      config: {
        systemInstruction: EXTRACTION_PROMPT_V1,
        responseMimeType: 'application/json',
        responseSchema: extractionSchema,
      },
    });

    const parsed = parseProblemExtraction(response.text);
    if (!parsed.ok) {
      console.warn('Extraction output rejected by server-side validation:', parsed.detail);
      return unavailableResult(recordedModelName, startedAt);
    }

    // An image with no problem in it is a successful call with nothing to tutor.
    // Confidence is forced to 0 so it cannot start a session on empty text.
    if (!parsed.value.containsProblem || parsed.value.extractedText.trim().length === 0) {
      return {
        extraction: {
          ...parsed.value,
          confidence: 0,
          extractionWarnings:
            parsed.value.extractionWarnings.length > 0
              ? parsed.value.extractionWarnings
              : ['No problem text was found in this image.'],
        },
        available: true,
        modelName: recordedModelName,
        latencyMs: Date.now() - startedAt,
        semanticValidation: null,
      };
    }

    const semantic = await runSemanticValidation({
      validationKind: 'image_extraction',
      data: {
        expectedGrade: context?.grade ?? null,
        expectedLanguage: context?.language ?? null,
        candidateExtraction: parsed.value,
      },
      image: { bytes, mimeType: format },
    });

    const semanticMetadata = {
      available: semantic.available,
      approved: semantic.approved,
      modelName: semantic.modelName,
      promptVersion: semantic.promptVersion,
      confidence: semantic.validation?.confidence ?? 0,
    };

    if (!semantic.approved) {
      const warning = semantic.available
        ? 'Independent image verification could not confirm this extraction. Please check the text before tutoring.'
        : 'Independent image verification was unavailable. Please check the text before tutoring.';

      return {
        extraction: {
          ...parsed.value,
          confidence: 0,
          extractionWarnings: [...parsed.value.extractionWarnings, warning].slice(0, 10),
        },
        available: true,
        modelName: recordedModelName,
        latencyMs: Date.now() - startedAt,
        semanticValidation: semanticMetadata,
      };
    }

    return {
      extraction: parsed.value,
      available: true,
      modelName: recordedModelName,
      latencyMs: Date.now() - startedAt,
      semanticValidation: semanticMetadata,
    };
  } catch (error) {
    console.warn(
      'Extraction or extraction-validation call failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return unavailableResult(recordedModelName, startedAt);
  }
}

export { EXTRACTION_PROMPT_VERSION };
