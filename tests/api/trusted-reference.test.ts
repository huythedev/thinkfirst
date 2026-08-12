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
    ['x^2 - 6x + 7 = 0', 'x = 3 - sqrt(2) or x = 3 + sqrt(2)'],
    ['x² - 5x + 6 = 0', 'x = 2 or x = 3'],
    ['2x^2 + 3x - 2 = 0', 'x = -2 or x = 1/2'],
    ['x^2 = 9', 'x = -3 or x = 3'],
    ['x^2 + 2x + 1 = 0', 'x = -1'],
    ['x^2 + x = 6', 'x = -3 or x = 2'],
    ['0.5x^2 - 2.5x + 2 = 0', 'x = 1 or x = 4'],
  ])('solves the deliberately supported form: %s', (problem, expected) => {
    expect(deriveTrustedReferenceAnswer(problem, 'mathematics')).toBe(expected);
  });

  it.each([
    'y + 3 = 7',
    'sin(x) = 0',
    'x^3 - 1 = 0',
    'x(x + 1) = 0',
    '2x + = 7',
    '2x + 3 =',
  ])('fails closed for unsupported or malformed input: %s', (problem) => {
    expect(deriveTrustedReferenceAnswer(problem, 'mathematics')).toBeNull();
  });
});
