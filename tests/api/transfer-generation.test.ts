import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { deterministicModelHandler } from '@/lib/ai/mock-model';
import { parseTransferProblem } from '@/lib/types/ai/model-output';
import { generateTransferProblem } from '@/lib/session/evaluation';

describe('Transfer Problem Mock and Parsing', () => {
  let originalDriver: string | undefined;

  beforeAll(() => {
    originalDriver = process.env.AI_MODEL_DRIVER;
    process.env.AI_MODEL_DRIVER = 'mock';
  });

  afterAll(() => {
    process.env.AI_MODEL_DRIVER = originalDriver;
  });

  it('mock transfer payload matches production schema', async () => {
    // 1. mock transfer payload matches production schema
    const mockRequest = {
      contents: [{ role: 'user', parts: [{ text: 'transfer' }] }],
      config: { systemInstruction: 'transfer' },
    };
    
    // @ts-ignore
    const result = await deterministicModelHandler(mockRequest);
    const parsed = parseTransferProblem(result.text);
    
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.problemMarkdown).toBe('Solve x^2 - 7x + 12 = 0 without help.');
      expect(parsed.value.topic).toBe('quadratic equations');
      expect(parsed.value.difficulty).toBe('similar');
      expect(parsed.value.expectedConcepts).toContain('factoring');
      expect(parsed.value.internalAnswer).toBe('x = 3 or x = 4');
      expect(parsed.value.internalSolutionSteps.length).toBeGreaterThan(0);
      expect(parsed.value.validationNotes.length).toBeGreaterThan(0);
    }
  });

  it('generates a fully validated transfer problem from the deterministic mock', async () => {
    const generated = await generateTransferProblem({
      problem: 'Original problem',
      topic: 'quadratic equations',
      grade: 9,
      conceptTags: ['factoring'],
    });

    expect(generated).not.toBeNull();
    expect(generated!.validated).toBe(true);
    expect(generated!.problem.internalAnswer).toBe('x = 3 or x = 4');
    // The final step is x = 3 or x = 4, which matches the internalAnswer, so validateAnswer returns equivalent.
  });
});
