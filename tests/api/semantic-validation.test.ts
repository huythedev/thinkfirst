import { describe, expect, it } from 'vitest';
import {
  isSemanticApproval,
  parseSemanticValidation,
} from '@/lib/types/ai/semantic-validation';

const approved = {
  approved: true,
  verdict: 'approved',
  confidence: 0.95,
  issues: [],
  correctedValue: null,
};

describe('semantic validation output', () => {
  it('accepts a clean high-confidence approval', () => {
    const parsed = parseSemanticValidation(JSON.stringify(approved));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(isSemanticApproval(parsed.value)).toBe(true);
  });

  it('rejects malformed JSON', () => {
    expect(parseSemanticValidation('{"approved":true').ok).toBe(false);
  });

  it('rejects confidence outside 0..1', () => {
    expect(
      parseSemanticValidation(JSON.stringify({ ...approved, confidence: 2 })).ok,
    ).toBe(false);
  });

  it('fails closed on low confidence', () => {
    const parsed = parseSemanticValidation(JSON.stringify({ ...approved, confidence: 0.69 }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(isSemanticApproval(parsed.value)).toBe(false);
  });

  it('does not accept an approval that still reports issues', () => {
    const parsed = parseSemanticValidation(
      JSON.stringify({ ...approved, issues: ['The unit is inconsistent.'] }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(isSemanticApproval(parsed.value)).toBe(false);
  });

  it('does not accept an approval that proposes a correction', () => {
    const parsed = parseSemanticValidation(
      JSON.stringify({ ...approved, correctedValue: '12 cm' }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(isSemanticApproval(parsed.value)).toBe(false);
  });

  it('accepts a single surrounding JSON code fence structurally', () => {
    const parsed = parseSemanticValidation(`\`\`\`json\n${JSON.stringify(approved)}\n\`\`\``);
    expect(parsed.ok).toBe(true);
  });
});
