import { describe, expect, it } from 'vitest';
import { deriveTrustedReferenceAnswer } from '@/lib/math/trusted-reference';

describe('deriveTrustedReferenceAnswer', () => {
  it.each([
    ['Solve 3x + 7 = 22.', 'x = 5'],
    ['Solve for x: 3x + 7 = 22?', 'x = 5'],
    ['3x + 7 = 22', 'x = 5'],
    ['2*x + 3 = 11', 'x = 4'],
    ['-2x + 3 = 11', 'x = -4'],
    ['0.5x + 3 = 11', 'x = 16'],
    ['2x + 3 = x + 7', 'x = 4'],
  ])('solves the deliberately supported form: %s', (problem, expected) => {
    expect(deriveTrustedReferenceAnswer(problem, 'mathematics')).toBe(expected);
  });

  it.each([
    'x^2 = 4',
    'y + 3 = 7',
    '2x + = 7',
    '2x + 3 =',
  ])('fails closed for unsupported or malformed input: %s', (problem) => {
    expect(deriveTrustedReferenceAnswer(problem, 'mathematics')).toBeNull();
  });
});
