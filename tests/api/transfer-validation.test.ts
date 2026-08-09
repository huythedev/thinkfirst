import { describe, expect, it } from 'vitest';
import {
  isTransferValidationApproved,
  parseTransferValidation,
} from '@/lib/types/ai/transfer-validation';

const approved = {
  valid: true,
  answerCorrect: true,
  stepsConsistent: true,
  problemUnambiguous: true,
  unitsCorrect: true,
  sameConcept: true,
  correctedAnswer: null,
  confidence: 0.95,
  issues: [],
};

describe('transfer validator output', () => {
  it('accepts a complete high-confidence approval', () => {
    const parsed = parseTransferValidation(JSON.stringify(approved));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(isTransferValidationApproved(parsed.value)).toBe(true);
  });

  it('rejects malformed model output', () => {
    expect(parseTransferValidation('{"valid":true').ok).toBe(false);
  });

  it('rejects confidence outside 0..1', () => {
    expect(
      parseTransferValidation(JSON.stringify({ ...approved, confidence: 4 })).ok,
    ).toBe(false);
  });

  it('fails closed when any load-bearing judgement is false', () => {
    const parsed = parseTransferValidation(
      JSON.stringify({ ...approved, unitsCorrect: false, valid: true }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(isTransferValidationApproved(parsed.value)).toBe(false);
  });

  it('fails closed on low-confidence approval', () => {
    const parsed = parseTransferValidation(JSON.stringify({ ...approved, confidence: 0.69 }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(isTransferValidationApproved(parsed.value)).toBe(false);
  });

  it('accepts JSON wrapped in one markdown code fence', () => {
    const parsed = parseTransferValidation(`\`\`\`json\n${JSON.stringify(approved)}\n\`\`\``);
    expect(parsed.ok).toBe(true);
  });
});
