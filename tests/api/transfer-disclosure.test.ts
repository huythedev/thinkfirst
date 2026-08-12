import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateTransferProblem } from '@/lib/session/evaluation';
import { setMockModelHandler, type GenerateContentRequest } from '@/lib/ai/model-client';
import { deterministicModelHandler } from '@/lib/ai/mock-model';

const baseTransfer = {
  problemMarkdown: 'Solve a different linear equation.',
  topic: 'linear equations',
  difficulty: 'similar',
  expectedConcepts: ['isolation'],
  internalAnswer: 'x = 4',
  internalSolutionSteps: ['x = 4'],
  validationNotes: [],
};

function isJudge(request: GenerateContentRequest): boolean {
  return JSON.stringify(request).includes('semantic disclosure judge');
}

describe('transfer disclosure authority', () => {
  beforeEach(() => {
    process.env.AI_MODEL_DRIVER = 'mock';
  });

  afterEach(() => {
    setMockModelHandler(deterministicModelHandler);
    vi.restoreAllMocks();
  });

  it.each([
    ['problemMarkdown', { ...baseTransfer, problemMarkdown: 'Solve this: x = 4' }],
    ['topic', { ...baseTransfer, topic: 'x = 4' }],
    ['expectedConcepts', { ...baseTransfer, expectedConcepts: ['x = 4'] }],
  ])('rejects an own-answer deterministic leak in %s without a judge appeal', async (_field, transfer) => {
    const handler = vi.fn().mockResolvedValue({ text: JSON.stringify(transfer) });
    setMockModelHandler(handler);

    const generated = await generateTransferProblem({
      problem: 'Solve x + 2 = 6', topic: 'linear equations', grade: 8,
      conceptTags: [], subject: 'mathematics',
    });

    expect(generated).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('rejects a protected original-answer deterministic leak without a judge appeal', async () => {
    const transfer = { ...baseTransfer, expectedConcepts: ['x = 9'] };
    const handler = vi.fn().mockResolvedValue({ text: JSON.stringify(transfer) });
    setMockModelHandler(handler);

    const generated = await generateTransferProblem({
      problem: 'Solve x + 2 = 11', topic: 'linear equations', grade: 8,
      conceptTags: [], subject: 'mathematics', protectedOriginalAnswer: 'x = 9',
    });

    expect(generated).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['safe', { verdict: 'safe', confidence: 0.95, reasonCode: 'no_disclosure' }, true],
    ['leak', { verdict: 'leak', confidence: 0.95, reasonCode: 'exact_answer' }, false],
    ['uncertain', { verdict: 'uncertain', confidence: 0.95, reasonCode: 'uncertain' }, false],
    ['low confidence', { verdict: 'safe', confidence: 0.4, reasonCode: 'no_disclosure' }, false],
  ])('uses the strict judge only when deterministic validation is unavailable: %s', async (_name, judge, accepted) => {
    const handler = vi.fn().mockImplementation((request: GenerateContentRequest) => Promise.resolve({
      text: JSON.stringify(isJudge(request) ? judge : baseTransfer),
    }));
    setMockModelHandler(handler);

    const generated = await generateTransferProblem({
      problem: 'Explain a science experiment', topic: 'variables', grade: 8,
      conceptTags: [], subject: 'science',
    });

    expect(generated !== null).toBe(accepted);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
