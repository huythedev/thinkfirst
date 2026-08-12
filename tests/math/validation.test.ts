import { describe, expect, test } from 'vitest';
import { validateAnswer, normalizeAnswer } from '@/lib/math/validation';

describe('Math Validation', () => {
  describe('normalizeAnswer', () => {
    test('removes thousands separators correctly', () => {
      expect(normalizeAnswer('1,234')).toBe('1234');
      expect(normalizeAnswer('12,500')).toBe('12500');
      expect(normalizeAnswer('12,345,678')).toBe('12345678');
    });

    test('handles set notation and multiple answer formats correctly', () => {
      expect(normalizeAnswer('x ∈ {2,3}')).toBe('2 or 3');
      expect(normalizeAnswer('x = 2 or x = 3')).toBe('2 or 3');
      expect(normalizeAnswer('min(2, 3)')).toBe('min(2, 3)');
      expect(normalizeAnswer('{1, 234}')).toBe('1 or  234');
      expect(normalizeAnswer('1, 234')).toBe('1 or  234');
    });
  });

  describe('validateAnswer', () => {
    test('returns unsupported for paraphrased or recoverable text answers', () => {
      const result1 = validateAnswer('The number you are looking for is one less than six.', 'x = 5');
      expect(result1.verdict).toBe('unsupported');

      const result2 = validateAnswer('The two solutions are the positive and negative square roots of 25.', 'x = 5 or x = -5');
      expect(result2.verdict).toBe('unsupported');
    });
    
    test('evaluates numeric equivalence correctly', () => {
      const result = validateAnswer('1,234', '1234');
      expect(result.verdict).toBe('equivalent');
      
      const result2 = validateAnswer('x = 1/2', '0.5');
      expect(result2.verdict).toBe('equivalent');
    });
  });
});
