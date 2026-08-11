import { describe, expect, it } from 'vitest';
import { deterministicModelHandler } from '@/lib/ai/mock-model';
import { parseTransferProblem } from '@/lib/types/ai/model-output';

describe('Transfer Problem Mock and Parsing', () => {
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
});
