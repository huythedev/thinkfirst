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

  it.each([
    'Nghiệm là x = 3 ± √2.',
    'x = 3 - √2 or 3 + √2',
    'x ∈ {3 - √2, 3 + √2}',
    'Hai nghiệm là 3 - sqrt(2) và 3 + sqrt(2).',
  ])('blocks equivalent quadratic root disclosure: %s', (messageMarkdown) => {
    const result = validateSemanticDisclosure({
      ...defaults,
      messageMarkdown,
      referenceAnswer: 'x = 3 - sqrt(2) or x = 3 + sqrt(2)',
    });
    expect(result.verdict).toBe('leak');
  });

  it('clears an early conceptual quadratic hint deterministically', () => {
    const result = validateSemanticDisclosure({
      ...defaults,
      messageMarkdown: 'Thử xác định a, b và c trước nhé.',
      referenceAnswer: 'x = 3 - sqrt(2) or x = 3 + sqrt(2)',
    });
    expect(result.verdict).toBe('safe');
  });

  it.each([
    ['English word-only answer', 'The answer is four.', 'x = 4'],
    ['Vietnamese word-only answer', 'Nghiệm là bốn.', 'x = 4'],
    ['word-only quadratic roots', 'Hai nghiệm là ba trừ căn hai và ba cộng căn hai.', 'x = 3 - sqrt(2) or x = 3 + sqrt(2)'],
  ])('does not deterministically clear a %s', (_name, messageMarkdown, referenceAnswer) => {
    const result = validateSemanticDisclosure({
      ...defaults,
      messageMarkdown,
      referenceAnswer,
    });
    expect(result.verdict).toBe('unavailable');
    expect(result.reason).toBe('no_deterministic_answer_candidate');
  });

  it('clears a narrow English classification question deterministically', () => {
    const result = validateSemanticDisclosure({
      ...defaults,
      messageMarkdown: 'What type of equation is this?',
      referenceAnswer: 'x = 4',
    });
    expect(result.verdict).toBe('safe');
    expect(result.reason).toBe('structural_tutoring_prompt');
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
    expect(result.verdict).toBe('unavailable');
    expect(result.reason).toBe('judge_uncertain');
  });

  it('blocks when the judge has low confidence', async () => {
    const result = await judgeSemanticDisclosure({
      ...defaults,
      candidateResponse: '__MOCK_JUDGE_LOW_CONFIDENCE__',
    });
    expect(result.verdict).toBe('unavailable');
    expect(result.reason).toBe('low_confidence');
  });

  it('blocks on malformed JSON', async () => {
    const result = await judgeSemanticDisclosure({
      ...defaults,
      candidateResponse: '__MOCK_JUDGE_MALFORMED__',
    });
    expect(result.verdict).toBe('unavailable');
    expect(result.reason).toBe('judge_failed');
  });

  it('blocks on invalid schema', async () => {
    const result = await judgeSemanticDisclosure({
      ...defaults,
      candidateResponse: '__MOCK_JUDGE_INVALID_SCHEMA__',
    });
    expect(result.verdict).toBe('unavailable');
    expect(result.reason).toBe('schema_invalid');
  });

  it('blocks on judge timeout', async () => {
    const result = await judgeSemanticDisclosure({
      ...defaults,
      candidateResponse: '__MOCK_JUDGE_TIMEOUT__',
    });
    expect(result.verdict).toBe('unavailable');
    expect(result.reason).toBe('judge_failed');
  }, 10000);

  it('permits original response when high-confidence safe', async () => {
    const result = await judgeSemanticDisclosure({
      ...defaults,
      candidateResponse: 'Here is a hint.',
    });
    expect(result.verdict).toBe('safe');
  });

  it.each([
    ['safe with leak code', '__MOCK_JUDGE_INCONSISTENT_SAFE__'],
    ['leak with safe code', '__MOCK_JUDGE_INCONSISTENT_LEAK__'],
  ])('fails closed for contradictory judge output: %s', async (_name, candidateResponse) => {
    const result = await judgeSemanticDisclosure({ ...defaults, candidateResponse });
    expect(result.verdict).toBe('unavailable');
    expect(result.reason).toBe('schema_invalid');
  });
});
