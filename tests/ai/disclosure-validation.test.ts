import { describe, it, expect } from 'vitest';
import { validateSemanticDisclosure } from '@/lib/ai/disclosure-validation';

describe('Disclosure Validation', () => {
  const defaults = {
    subject: 'mathematics',
    fullSolutionAllowedThisTurn: false,
  };

  it('detects a direct semantic leak where metadata lies completely', () => {
    const result = validateSemanticDisclosure({
      ...defaults,
      messageMarkdown: 'Try thinking about the equation. By the way, x = 4.',
      referenceAnswer: 'x = 4',
    });
    expect(result.verdict).toBe('leak');
  });

  it('detects a leak disguised as feedback', () => {
    const result = validateSemanticDisclosure({
      ...defaults,
      messageMarkdown: 'Your reasoning is close. The correct result is x = 4.',
      referenceAnswer: 'x = 4',
    });
    expect(result.verdict).toBe('leak');
  });

  it('detects answers inside Markdown/LaTeX', () => {
    const result = validateSemanticDisclosure({
      ...defaults,
      messageMarkdown: 'So the roots would be $x=2$ and $x=3$.',
      referenceAnswer: 'x = 2 or x = 3',
    });
    expect(result.verdict).toBe('leak');
  });

  it('allows harmless intermediate values', () => {
    const result = validateSemanticDisclosure({
      ...defaults,
      messageMarkdown: 'Subtract 3 from both sides to get 2x = 8.',
      referenceAnswer: 'x = 4',
    });
    expect(result.verdict).toBe('unavailable');
  });

  it('allows full solutions when authorized', () => {
    const result = validateSemanticDisclosure({
      ...defaults,
      messageMarkdown: 'The correct result is x = 4.',
      referenceAnswer: 'x = 4',
      fullSolutionAllowedThisTurn: true,
    });
    expect(result.verdict).toBe('safe');
  });

  it('returns unavailable when unsupported', () => {
    const result = validateSemanticDisclosure({
      ...defaults,
      subject: 'science',
      messageMarkdown: 'The correct result is x = 4.',
      referenceAnswer: 'x = 4',
    });
    expect(result.verdict).toBe('unavailable');
  });
});
