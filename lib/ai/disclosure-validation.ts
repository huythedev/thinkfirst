import { validateAnswer } from '@/lib/math/validation';
import { getModelClient } from '@/lib/ai/model-client';
import { Type, Schema as GeminiSchema } from '@google/genai';
import { z } from 'zod';

export const DISCLOSURE_JUDGE_MIN_CONFIDENCE = 0.8;

const disclosureJudgeSchema = z.object({
  verdict: z.enum(['safe', 'leak', 'uncertain']),
  confidence: z.number().min(0).max(1),
  reasonCode: z.enum([
    'exact_answer',
    'equivalent_answer',
    'partial_answer',
    'recoverable_answer',
    'confirmation_leak',
    'no_disclosure',
    'uncertain'
  ]),
}).strict();

export interface DisclosureValidationInput {
  messageMarkdown: string;
  referenceAnswer: string | null;
  subject: string;
  fullSolutionAllowedThisTurn: boolean;
}

export interface DisclosureValidationResult {
  verdict: 'safe' | 'leak' | 'unavailable';
  confidence: number;
  reason: string;
}

export function validateSemanticDisclosure(input: DisclosureValidationInput): DisclosureValidationResult {
  if (input.fullSolutionAllowedThisTurn) {
    return { verdict: 'safe', confidence: 1, reason: 'Full solution authorized this turn.' };
  }

  if (!input.referenceAnswer || input.referenceAnswer.trim().length === 0) {
    return { verdict: 'unavailable', confidence: 0, reason: 'No trusted reference answer available.' };
  }

  // MVP: Focus on mathematics subject.
  if (input.subject !== 'mathematics') {
    return { verdict: 'unavailable', confidence: 0, reason: 'Semantic disclosure validation only supported for mathematics MVP.' };
  }

  const candidates = extractCandidates(input.messageMarkdown);
  
  // Split the reference answer to handle cases like "x = 2 or x = 3"
  const referenceParts = input.referenceAnswer.split(/,| or | and /).map(p => p.trim()).filter(p => p.length > 0);
  
  let allUnsupported = true;
  let hasUnsupported = false;
  
  for (const candidate of candidates) {
    // Check against the whole reference answer
    const result = validateAnswer(candidate, input.referenceAnswer);
    if (result.verdict === 'equivalent') {
      return {
        verdict: 'leak',
        confidence: result.confidence,
        reason: 'trusted_answer_match',
      };
    }
    if (result.verdict !== 'unsupported') {
      allUnsupported = false;
    } else {
      hasUnsupported = true;
    }
    
    // Check against parts of the reference answer
    if (referenceParts.length > 1) {
      for (const refPart of referenceParts) {
        const partResult = validateAnswer(candidate, refPart);
        if (partResult.verdict === 'equivalent') {
          return {
            verdict: 'leak',
            confidence: partResult.confidence,
            reason: 'trusted_answer_match',
          };
        }
        if (partResult.verdict !== 'unsupported') {
          allUnsupported = false;
        } else {
          hasUnsupported = true;
        }
      }
    }
  }

  if (hasUnsupported) {
    return { verdict: 'unavailable', confidence: 0, reason: 'Some checks unsupported, safety cannot be fully established.' };
  }

  return { verdict: 'safe', confidence: 1, reason: 'No mathematical leakage of the reference answer detected.' };
}

function extractCandidates(text: string): string[] {
  const candidates = new Set<string>();

  // 1. Math mode blocks $$ ... $$ or $ ... $ or \( ... \) or \[ ... \]
  const mathBlocks = text.match(/\$\$?[^$]+\$\$?|\\\[.*?\\\]|\\\(.*?\\\)/g) || [];
  for (const match of mathBlocks) {
    candidates.add(match);
  }

  // 2. Lines with equal signs, potentially x = 4 or similar.
  const lines = text.split('\n');
  for (const line of lines) {
    candidates.add(line);
    const subparts = line.split(/,| or | and /);
    for (const part of subparts) {
      candidates.add(part);
    }
  }

  // 3. Sentences
  const sentences = text.split(/[.?!](?:\s|$)/);
  for (const sentence of sentences) {
    candidates.add(sentence);
    const subparts = sentence.split(/,| or | and | is |:| be | are /);
    for (const part of subparts) {
      candidates.add(part);
    }
  }
  
  // 4. x \in {2, 3} pattern
  const inPattern = /\\in\s*\\?\{[^}]+\}/g;
  const inMatches = text.match(inPattern) || [];
  for (const match of inMatches) {
    candidates.add(match);
  }
  
  // Clean up punctuation at the ends of candidates
  return Array.from(candidates).map(c => c.replace(/^[.?!,;:\s]+|[.?!,;:\s]+$/g, '')).filter(c => c.length > 0);
}

export interface JudgeSemanticDisclosureInput {
  problem: string;
  referenceAnswer: string;
  candidateResponse: string;
  responsePlan: {
    action: string;
    allowedHintLevel: number;
    mayRevealFinalAnswer: boolean;
  };
}

export const DISCLOSURE_JUDGE_TIMEOUT_MS = 5000;

export async function judgeSemanticDisclosure(input: JudgeSemanticDisclosureInput): Promise<DisclosureValidationResult> {
  const judgePrompt = `You are a semantic disclosure judge. Determine if the candidate response reveals the final mathematical answer or confirms it, given the action plan constraints.
Problem: ${input.problem}
Reference Answer: ${input.referenceAnswer}
Candidate Response: ${input.candidateResponse}
Response Plan Action: ${input.responsePlan.action}
Response Plan Allowed Hint Level: ${input.responsePlan.allowedHintLevel}
Response Plan May Reveal Final Answer: ${input.responsePlan.mayRevealFinalAnswer}`;

  const judgeSchema: GeminiSchema = {
    type: Type.OBJECT,
    properties: {
      verdict: { type: Type.STRING, enum: ['safe', 'leak', 'uncertain'] },
      confidence: { type: Type.NUMBER },
      reasonCode: {
        type: Type.STRING,
        enum: ['exact_answer', 'equivalent_answer', 'partial_answer', 'recoverable_answer', 'confirmation_leak', 'no_disclosure', 'uncertain']
      }
    },
    required: ['verdict', 'confidence', 'reasonCode']
  };

  const ai = getModelClient();

  const apiCall = ai.models.generateContent({
    model: process.env.GEMINI_DISCLOSURE_JUDGE_MODEL || 'gemini-3.6-flash',
    contents: [{ role: 'user', parts: [{ text: judgePrompt }] }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: judgeSchema,
      temperature: 0.1,
    },
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('Disclosure judge timed out.'));
    }, DISCLOSURE_JUDGE_TIMEOUT_MS);
  });

  try {
    const judgeResponse = await Promise.race([apiCall, timeoutPromise]);
    const rawText = (judgeResponse.text || '').trim().replace(/^```json|```$/g, '').trim();
    const judgeParse = JSON.parse(rawText || '{}');
    const parsed = disclosureJudgeSchema.safeParse(judgeParse);

    if (!parsed.success) {
      return { verdict: 'leak', confidence: 0, reason: 'schema_invalid' };
    }

    if (parsed.data.confidence < DISCLOSURE_JUDGE_MIN_CONFIDENCE) {
      return { verdict: 'leak', confidence: parsed.data.confidence, reason: 'low_confidence' };
    }

    if (parsed.data.verdict === 'uncertain') {
       return { verdict: 'leak', confidence: parsed.data.confidence, reason: 'judge_uncertain' };
    }

    return {
      verdict: parsed.data.verdict,
      confidence: parsed.data.confidence,
      reason: parsed.data.reasonCode,
    };
  } catch (e) {
    console.error('Semantic judge failed:', e);
    return { verdict: 'leak', confidence: 0, reason: 'judge_failed' };
  }
}
