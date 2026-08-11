import { validateAnswer } from '@/lib/math/validation';

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
