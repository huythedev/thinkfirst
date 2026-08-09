import { describe, expect, it } from 'vitest';
import { preserveIntentSafetySignal } from '@/lib/ai/semantic-validation';
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

const safetyCandidate = {
  candidateAnalysis: {
    safetyCategory: 'self_harm',
    confidence: 0.82,
  },
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

describe('monotonic safety fallback', () => {
  it('preserves a primary classifier safety signal when the verifier is unavailable', () => {
    const fallback = preserveIntentSafetySignal(
      'intent_classification',
      safetyCandidate,
      null,
      'validator unavailable',
    );

    expect(fallback).toMatchObject({
      approved: false,
      verdict: 'rejected',
      correctedValue: 'self_harm',
    });
  });

  it('preserves a primary safety signal when the verifier rejects without a correction', () => {
    const fallback = preserveIntentSafetySignal(
      'intent_classification',
      safetyCandidate,
      {
        approved: false,
        verdict: 'rejected',
        confidence: 0.74,
        issues: ['classification disagreement'],
        correctedValue: null,
      },
      'preserve safety',
    );

    expect(fallback?.correctedValue).toBe('self_harm');
    expect(fallback?.issues).toContain('classification disagreement');
    expect(fallback?.issues).toContain('preserve safety');
  });

  it('keeps a verifier-provided restrictive safety correction', () => {
    const fallback = preserveIntentSafetySignal(
      'intent_classification',
      safetyCandidate,
      {
        approved: false,
        verdict: 'rejected',
        confidence: 0.91,
        issues: [],
        correctedValue: 'abuse',
      },
      'preserve safety',
    );

    expect(fallback?.correctedValue).toBe('abuse');
  });

  it('does not invent a safety signal when the primary classifier reported none', () => {
    const fallback = preserveIntentSafetySignal(
      'intent_classification',
      { candidateAnalysis: { safetyCategory: 'none' } },
      null,
      'validator unavailable',
    );

    expect(fallback).toBeNull();
  });

  it('does not alter non-classifier validation kinds', () => {
    const validation = {
      approved: false,
      verdict: 'rejected' as const,
      confidence: 0.8,
      issues: ['bad tutor response'],
      correctedValue: null,
    };

    expect(
      preserveIntentSafetySignal('tutor_response', safetyCandidate, validation, 'unused'),
    ).toBe(validation);
  });
});
