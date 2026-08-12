import { validateAnswer } from '@/lib/math/validation';
import { getModelClient } from '@/lib/ai/model-client';
import { Type, Schema as GeminiSchema } from '@google/genai';
import { z } from 'zod';

export const DISCLOSURE_JUDGE_MIN_CONFIDENCE = 0.8;
/** A reference-free clearance has less evidence, so it deliberately needs more. */
export const REFERENCE_FREE_DISCLOSURE_JUDGE_MIN_CONFIDENCE = 0.9;

const disclosureJudgeSchema = z.discriminatedUnion('verdict', [
  z.object({
    verdict: z.literal('safe'),
    confidence: z.number().min(0).max(1),
    reasonCode: z.literal('no_disclosure'),
  }).strict(),
  z.object({
    verdict: z.literal('uncertain'),
    confidence: z.number().min(0).max(1),
    reasonCode: z.literal('uncertain'),
  }).strict(),
  z.object({
    verdict: z.literal('leak'),
    confidence: z.number().min(0).max(1),
    reasonCode: z.enum([
      'exact_answer',
      'equivalent_answer',
      'partial_answer',
      'recoverable_answer',
      'confirmation_leak',
      'solution_too_far',
    ]),
  }).strict(),
]);

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

export type DisclosureJudgeResult = DisclosureValidationResult & {
  judgeVerdict: 'safe' | 'leak' | 'uncertain' | 'failed';
  reasonCode: string;
};

/** A non-safe result is never permission to disclose. */
export function shouldWithholdForDisclosure(
  fullSolutionAllowedThisTurn: boolean,
  result: DisclosureValidationResult,
): boolean {
  return !fullSolutionAllowedThisTurn && result.verdict !== 'safe';
}

export function validateSemanticDisclosure(input: DisclosureValidationInput): DisclosureValidationResult {
  if (input.fullSolutionAllowedThisTurn) {
    return { verdict: 'safe', confidence: 1, reason: 'full_solution_authorized' };
  }
  if (!input.referenceAnswer?.trim()) {
    return { verdict: 'unavailable', confidence: 0, reason: 'no_trusted_reference' };
  }
  if (input.subject !== 'mathematics') {
    return { verdict: 'unavailable', confidence: 0, reason: 'subject_unsupported' };
  }
  if (containsExactQuadraticRootLeak(input.messageMarkdown, input.referenceAnswer)) {
    return { verdict: 'leak', confidence: 1, reason: 'trusted_answer_match' };
  }

  const candidates = extractCandidates(input.messageMarkdown).filter(looksLikeMathematicalAnswer);
  // Parsing nothing proves nothing. In particular, a final answer written only
  // in words would otherwise bypass both deterministic comparison and the
  // semantic judge. Only a deliberately narrow, structurally pedagogical
  // prompt can clear without a candidate; all other prose is uncertainty.
  if (candidates.length === 0) {
    return isClearlyNonAnswerTutoringPrompt(input.messageMarkdown)
      ? { verdict: 'safe', confidence: 1, reason: 'structural_tutoring_prompt' }
      : { verdict: 'unavailable', confidence: 0, reason: 'no_deterministic_answer_candidate' };
  }
  const referenceParts = input.referenceAnswer.split(/,|\s+or\s+|\s+and\s+/i).map((part) => part.trim()).filter(Boolean);
  let hasUnsupported = false;

  for (const candidate of candidates) {
    const whole = validateAnswer(candidate, input.referenceAnswer);
    if (whole.verdict === 'equivalent') return { verdict: 'leak', confidence: whole.confidence, reason: 'trusted_answer_match' };
    if (whole.verdict === 'unsupported') hasUnsupported = true;
    for (const part of referenceParts) {
      const checked = validateAnswer(candidate, part);
      if (checked.verdict === 'equivalent') return { verdict: 'leak', confidence: checked.confidence, reason: 'trusted_answer_match' };
      if (checked.verdict === 'unsupported') hasUnsupported = true;
    }
  }
  return hasUnsupported
    ? { verdict: 'unavailable', confidence: 0, reason: 'deterministic_comparison_unsupported' }
    : { verdict: 'safe', confidence: 1, reason: 'no_mathematical_leak_detected' };
}

function extractCandidates(text: string): string[] {
  const candidates = new Set<string>();
  for (const match of text.match(/\$\$?[^$]+\$\$?|\\\[.*?\\\]|\\\(.*?\\\)/g) || []) candidates.add(match);
  for (const line of text.split('\n')) {
    candidates.add(line);
    for (const part of line.split(/,|\s+or\s+|\s+and\s+/i)) candidates.add(part);
  }
  for (const sentence of text.split(/[.?!](?:\s|$)/)) {
    candidates.add(sentence);
    for (const part of sentence.split(/,|\s+or\s+|\s+and\s+|\s+is\s+|:|\s+be\s+|\s+are\s+/i)) candidates.add(part);
  }
  for (const match of text.match(/(?:\\in|∈)\s*\\?\{[^}]+\}/g) || []) candidates.add(match);
  return [...candidates].map((value) => value.replace(/^[.?!,;:\s]+|[.?!,;:\s]+$/g, '')).filter(Boolean);
}

function looksLikeMathematicalAnswer(value: string): boolean {
  return /(?:=|∈|\\in|±|√|sqrt\s*\(|\d)/i.test(value);
}

/**
 * A tiny safe allowlist for non-answer tutoring language. This is not a
 * natural-language answer detector: it proves only that a short, single
 * sentence is asking for classification or directing one bounded process step.
 * Anything declarative, answer-like, multilingual outside these forms, or
 * otherwise ambiguous goes to the semantic judge instead.
 */
function isClearlyNonAnswerTutoringPrompt(message: string): boolean {
  const text = message.replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 180 || looksLikeMathematicalAnswer(text)) return false;

  // These words signal a final-answer/result assertion or confirmation. They
  // are exclusions, not an attempt to parse answers across languages.
  if (/\b(?:answer|result|solution|root|roots)\b|(?:nghiệm|đáp án|kết quả)/iu.test(text)) return false;

  const classificationQuestion = /^(?:what|which|how|why|where|when)\b[^?]*\?$/iu;
  const boundedPrompt = /^(?:try\s+(?:to\s+)?(?:identify|classify|choose|explain|attempt|isolat(?:e|ing)|subtract(?:ing)?|add(?:ing)?|multiply(?:ing)?|divide(?:ing)?)\b|thử\s+(?:xác định|phân loại|chọn|giải thích|làm)\b)[^.?!]*[.?!]?$/iu;
  return classificationQuestion.test(text) || boundedPrompt.test(text);
}

export interface JudgeSemanticDisclosureInput {
  problem: string;
  /** Omitted only for the stricter reference-free clearance path. */
  referenceAnswer?: string | null;
  candidateResponse: string;
  responsePlan: { action: string; allowedHintLevel: number; mayRevealFinalAnswer: boolean };
}

export const DISCLOSURE_JUDGE_TIMEOUT_MS = 5000;

/**
 * The judge is a strict clearance gate. Its result is intentionally mapped to
 * `unavailable` for failure/uncertainty/low confidence so telemetry never calls
 * a validator outage a final-answer leak.
 */
export async function judgeSemanticDisclosure(input: JudgeSemanticDisclosureInput): Promise<DisclosureJudgeResult> {
  const referenceFree = !input.referenceAnswer;
  const judgePrompt = referenceFree
    ? `You are a strict semantic disclosure judge. There is no trusted final answer available. Determine whether the candidate response itself gives, confirms, or makes trivially recoverable a final answer or complete solution, or goes materially beyond the currently allowed pedagogical step. Return safe only when highly confident it does neither.\nProblem: ${input.problem}\nCandidate Response: ${input.candidateResponse}\nResponse Plan Action: ${input.responsePlan.action}\nResponse Plan Allowed Hint Level: ${input.responsePlan.allowedHintLevel}\nMay Reveal Final Answer: ${input.responsePlan.mayRevealFinalAnswer}`
    : `You are a semantic disclosure judge. Determine if the candidate response reveals the final mathematical answer or confirms it, given the action plan constraints.\nProblem: ${input.problem}\nReference Answer: ${input.referenceAnswer}\nCandidate Response: ${input.candidateResponse}\nResponse Plan Action: ${input.responsePlan.action}\nResponse Plan Allowed Hint Level: ${input.responsePlan.allowedHintLevel}\nMay Reveal Final Answer: ${input.responsePlan.mayRevealFinalAnswer}`;

  const judgeSchema: GeminiSchema = {
    type: Type.OBJECT,
    properties: {
      verdict: { type: Type.STRING, enum: ['safe', 'leak', 'uncertain'] },
      confidence: { type: Type.NUMBER },
      reasonCode: { type: Type.STRING, enum: ['exact_answer', 'equivalent_answer', 'partial_answer', 'recoverable_answer', 'confirmation_leak', 'solution_too_far', 'no_disclosure', 'uncertain'] },
    },
    required: ['verdict', 'confidence', 'reasonCode'],
  };
  const ai = getModelClient();
  const apiCall = ai.models.generateContent({
    model: process.env.GEMINI_DISCLOSURE_JUDGE_MODEL || 'gemini-3.6-flash',
    contents: [{ role: 'user', parts: [{ text: judgePrompt }] }],
    config: { responseMimeType: 'application/json', responseSchema: judgeSchema, temperature: 0.1 },
  });
  const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Disclosure judge timed out.')), DISCLOSURE_JUDGE_TIMEOUT_MS));
  try {
    const judgeResponse = await Promise.race([apiCall, timeoutPromise]);
    const rawText = (judgeResponse.text || '').trim().replace(/^```json|```$/g, '').trim();
    const parsed = disclosureJudgeSchema.safeParse(JSON.parse(rawText || '{}'));
    if (!parsed.success) return { verdict: 'unavailable', confidence: 0, reason: 'schema_invalid', judgeVerdict: 'failed', reasonCode: 'schema_invalid' };
    const minimum = referenceFree ? REFERENCE_FREE_DISCLOSURE_JUDGE_MIN_CONFIDENCE : DISCLOSURE_JUDGE_MIN_CONFIDENCE;
    if (parsed.data.confidence < minimum) return { verdict: 'unavailable', confidence: parsed.data.confidence, reason: 'low_confidence', judgeVerdict: parsed.data.verdict, reasonCode: 'low_confidence' };
    if (parsed.data.verdict === 'uncertain') return { verdict: 'unavailable', confidence: parsed.data.confidence, reason: 'judge_uncertain', judgeVerdict: 'uncertain', reasonCode: 'uncertain' };
    return { verdict: parsed.data.verdict, confidence: parsed.data.confidence, reason: parsed.data.reasonCode, judgeVerdict: parsed.data.verdict, reasonCode: parsed.data.reasonCode };
  } catch (error) {
    console.error('Semantic judge failed:', error);
    return { verdict: 'unavailable', confidence: 0, reason: 'judge_failed', judgeVerdict: 'failed', reasonCode: 'judge_failed' };
  }
}

function containsExactQuadraticRootLeak(candidate: string, reference: string): boolean {
  const roots = reference.split(/\s+(?:or|and)\s+/i).map((part) => part.replace(/^x\s*(?:=|∈)\s*/i, '').trim()).filter(Boolean);
  if (roots.length !== 2) return false;
  const normalizedCandidate = normalizeMathText(candidate);
  const normalizedRoots = roots.map(normalizeMathText);
  if (normalizedRoots.every((root) => normalizedCandidate.includes(root))) return true;
  const plusMinus = normalizedCandidate.match(/x=([+-]?(?:\d+(?:\.\d+)?))(?:\*)?±(sqrt\([^)]*\))/);
  if (!plusMinus) return false;
  const [, centre, radical] = plusMinus;
  return normalizedRoots.includes(`${centre}-${radical}`) && normalizedRoots.includes(`${centre}+${radical}`);
}

function normalizeMathText(value: string): string {
  return value.toLowerCase()
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, 'sqrt($1)')
    .replace(/√\s*\(?\s*([^\s,).]+)\s*\)?/g, 'sqrt($1)')
    .replace(/\\in/g, '∈')
    .replace(/[{}\[\]$\\\s]/g, '');
}
