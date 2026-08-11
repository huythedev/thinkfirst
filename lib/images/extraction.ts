import { Schema, Type } from '@google/genai';
import { getModelClient } from '@/lib/ai/model-client';
import { EXTRACTION_PROMPT_V1 } from '@/services/ai-gateway/src/prompts/extraction.v1';
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
  /** False when the model failed or returned something the schema rejected. */
  available: boolean;
  modelName: string;
  latencyMs: number;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Runs extraction and returns a result that is always safe to act on.
 *
 * Every failure path returns `UNAVAILABLE_EXTRACTION`, whose confidence is 0.
 * That is deliberately below rule R6's threshold, so a failed extraction routes
 * into the same confirmation flow as a poor one rather than into a separate
 * error branch that could forget to require confirmation.
 */
export async function extractProblemFromImage(
  bytes: Uint8Array,
  format: ImageFormat,
  context?: { grade?: number; language?: 'en' | 'vi' },
): Promise<ExtractionResult> {
  const modelName = process.env.GEMINI_EXTRACTION_MODEL || 'gemini-2.5-pro';
  const startedAt = Date.now();

  const hint =
    `Student grade: ${context?.grade ?? 'unknown'}. ` +
    `Expected language: ${context?.language ?? 'unknown'}.`;

  try {
    const response = await getModelClient().models.generateContent({
      model: modelName,
      contents: [
        {
          role: 'user',
          parts: [
            { text: EXTRACTION_PROMPT_V1 + '\n\n' + hint },
            { inlineData: { mimeType: format, data: toBase64(bytes) } },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: extractionSchema,
        // Transcription, not composition. A creative temperature here invents
        // plausible characters where the image is blurred, which is the exact
        // failure R6 exists to catch and is better avoided than caught.
        temperature: 0,
      },
    });

    const parsed = parseProblemExtraction(response.text);
    if (!parsed.ok) {
      console.warn('Extraction output rejected by server-side validation:', parsed.detail);
      return {
        extraction: UNAVAILABLE_EXTRACTION,
        available: false,
        modelName,
        latencyMs: Date.now() - startedAt,
      };
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
        modelName,
        latencyMs: Date.now() - startedAt,
      };
    }

    return {
      extraction: parsed.value,
      available: true,
      modelName,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    console.warn(
      'Extraction call failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return {
      extraction: UNAVAILABLE_EXTRACTION,
      available: false,
      modelName,
      latencyMs: Date.now() - startedAt,
    };
  }
}
