import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { validateSemanticDisclosure, judgeSemanticDisclosure } from '@/lib/ai/disclosure-validation';

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

describe('judgeSemanticDisclosure', () => {
  let originalDriver: string | undefined;

  beforeAll(() => {
    originalDriver = process.env.AI_MODEL_DRIVER;
    process.env.AI_MODEL_DRIVER = 'mock';
  });

  afterAll(() => {
    process.env.AI_MODEL_DRIVER = originalDriver;
  });

  const defaults = {
    problem: 'Solve 2x = 8',
    referenceAnswer: 'x = 4',
    responsePlan: { action: 'provide_hint', allowedHintLevel: 1, mayRevealFinalAnswer: false },
  };

  it('blocks when the judge returns leak', async () => {
    const result = await judgeSemanticDisclosure({
      ...defaults,
      candidateResponse: '__MOCK_JUDGE_LEAK__',
    });
    expect(result.verdict).toBe('leak');
  });

  it('blocks when the judge returns uncertain', async () => {
    const result = await judgeSemanticDisclosure({
      ...defaults,
      candidateResponse: '__MOCK_JUDGE_UNCERTAIN__',
    });
    expect(result.verdict).toBe('leak');
  });

  it('blocks when the judge has low confidence', async () => {
    const result = await judgeSemanticDisclosure({
      ...defaults,
      candidateResponse: '__MOCK_JUDGE_LOW_CONFIDENCE__',
    });
    expect(result.verdict).toBe('leak');
    expect(result.reason).toBe('low_confidence');
  });

  it('blocks on malformed JSON', async () => {
    const result = await judgeSemanticDisclosure({
      ...defaults,
      candidateResponse: '__MOCK_JUDGE_MALFORMED__',
    });
    expect(result.verdict).toBe('leak');
    expect(result.reason).toBe('judge_failed');
  });

  it('blocks on invalid schema', async () => {
    const result = await judgeSemanticDisclosure({
      ...defaults,
      candidateResponse: '__MOCK_JUDGE_INVALID_SCHEMA__',
    });
    expect(result.verdict).toBe('leak');
    expect(result.reason).toBe('schema_invalid');
  });

  it('permits original response when high-confidence safe', async () => {
    const result = await judgeSemanticDisclosure({
      ...defaults,
      candidateResponse: 'Here is a hint.',
    });
    expect(result.verdict).toBe('safe');
  });
});
