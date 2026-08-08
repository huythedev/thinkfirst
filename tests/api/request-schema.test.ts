import { describe, expect, it } from 'vitest';
import { chatRequestSchema, MODE_VALUES, STRICTNESS_VALUES } from '@/lib/types/ai/request';

/**
 * The contract narrowed in session 08. It used to carry a `sessionData` object
 * holding `mode`, `strictness`, `currentHintLevel` and `grade`, validated and
 * clamped. Section 41.1 is explicit that clamping is not a source of truth, so
 * those fields left the contract entirely and are read server-side instead.
 *
 * Shape-level rejection of the old body lives in `tests/policy/policy-inputs.test.ts`.
 * What remains here is the surface the client legitimately controls.
 */

const validBody = {
  message: 'I factored it into (x-2)(x-3).',
  sessionId: 'session-abc',
};

describe('chatRequestSchema', () => {
  it('accepts a well-formed request', () => {
    expect(chatRequestSchema.safeParse(validBody).success).toBe(true);
  });

  it('rejects an empty message', () => {
    expect(chatRequestSchema.safeParse({ ...validBody, message: '' }).success).toBe(false);
  });

  it('rejects a message beyond the length ceiling', () => {
    const result = chatRequestSchema.safeParse({ ...validBody, message: 'x'.repeat(5001) });
    expect(result.success).toBe(false);
  });

  it('requires a session id', () => {
    expect(chatRequestSchema.safeParse({ message: 'hello' }).success).toBe(false);
  });

  it('rejects an empty session id', () => {
    expect(chatRequestSchema.safeParse({ ...validBody, sessionId: '' }).success).toBe(false);
  });

  it('no longer accepts the policy fields it used to clamp', () => {
    const legacy = {
      ...validBody,
      sessionData: {
        originalProblem: 'Solve x^2 - 5x + 6 = 0',
        subject: 'mathematics',
        grade: 9,
        language: 'en',
        mode: 'practice',
        strictness: 'balanced',
        currentHintLevel: 0,
      },
      priorTurns: [{ actor: 'student', content: 'hello' }],
    };
    expect(chatRequestSchema.safeParse(legacy).success).toBe(false);
  });

  it('exposes exactly the four modes the policy engine handles', () => {
    expect([...MODE_VALUES].sort()).toEqual(['assignment', 'learn', 'practice', 'verify']);
  });

  it('exposes exactly the four strictness levels module 02 section 9 defines', () => {
    expect([...STRICTNESS_VALUES].sort()).toEqual([
      'assessment_safe',
      'balanced',
      'independence',
      'supportive',
    ]);
  });
});
