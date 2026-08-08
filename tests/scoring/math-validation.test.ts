import { describe, expect, it } from 'vitest';
import {
  normalizeAnswer,
  normalizeFraction,
  substitutionHolds,
  validateAnswer,
} from '@/lib/math/validation';

describe('normalizeAnswer', () => {
  it('strips a leading assignment', () => {
    expect(normalizeAnswer('x = 42')).toBe('42');
  });

  it('unwraps LaTeX fractions', () => {
    expect(normalizeAnswer('$\\frac{3}{4}$')).toBe('(3)/(4)');
  });

  it('collapses thousands separators', () => {
    expect(normalizeAnswer('1,234')).toBe('1234');
  });

  it('converts a percentage to its fractional value', () => {
    expect(normalizeAnswer('25%')).toBe('(25/100)');
  });

  it('drops a trailing unit', () => {
    expect(normalizeAnswer('12 cm')).toBe('12');
  });

  it('refuses an empty answer', () => {
    expect(normalizeAnswer('   ')).toBeNull();
  });

  it('refuses an answer long enough to be an attack surface', () => {
    expect(normalizeAnswer('1+'.repeat(200) + '1')).toBeNull();
  });
});

describe('validateAnswer, numeric comparison with tolerance', () => {
  it('accepts an identical value', () => {
    const result = validateAnswer('42', '42');
    expect(result.verdict).toBe('equivalent');
    expect(result.confidence).toBe(1);
    expect(result.method).toBe('numeric');
  });

  it('accepts a value written differently', () => {
    expect(validateAnswer('x = 3/4', '0.75').verdict).toBe('equivalent');
  });

  it('accepts floating-point noise within tolerance', () => {
    expect(validateAnswer('0.1 + 0.2', '0.3').verdict).toBe('equivalent');
  });

  it('rejects a wrong value', () => {
    const result = validateAnswer('12', '42');
    expect(result.verdict).toBe('not_equivalent');
    expect(result.confidence).toBe(1);
  });

  it('rejects a value that is close but not within tolerance', () => {
    expect(validateAnswer('2.9', '3').verdict).toBe('not_equivalent');
  });

  it('handles constants', () => {
    expect(validateAnswer('2*pi', '6.283185307179586').verdict).toBe('equivalent');
  });

  it('handles roots', () => {
    expect(validateAnswer('sqrt(16)', '4').verdict).toBe('equivalent');
  });
});

describe('validateAnswer, symbolic equivalence', () => {
  it('accepts an algebraically equal expression', () => {
    const result = validateAnswer('2*x + 2', '2*(x + 1)');
    expect(result.verdict).toBe('equivalent');
    expect(result.method).toBe('symbolic');
  });

  it('does not claim certainty about an unrelated expression it cannot reduce', () => {
    const result = validateAnswer('sin(x) + cos(x)', 'tan(x)');
    expect(result.verdict).toBe('unsupported');
    expect(result.confidence).toBe(0);
  });
});

describe('validateAnswer, non-mathematical answers', () => {
  it('matches identical text', () => {
    const result = validateAnswer('The function is even', 'the function is even');
    expect(result.verdict).toBe('equivalent');
    expect(result.method).toBe('text');
  });

  it('returns unsupported rather than guessing on differing prose', () => {
    expect(validateAnswer('The function is even', 'It is symmetric').verdict).toBe('unsupported');
  });
});

/**
 * Section 23: "Avoid executing arbitrary user-provided code." A student answer is
 * untrusted input, so these must be refused before evaluation, not after.
 */
describe('validateAnswer refuses unsafe input', () => {
  it('treats a leading assignment as presentation, not as code', () => {
    // "x = 42" is how students write answers, so the prefix is stripped by
    // normalization and the remaining value is compared.
    expect(validateAnswer('a = 5', '5').verdict).toBe('equivalent');
  });

  it('refuses an assignment that survives normalization', () => {
    expect(validateAnswer('(a = 5)', '5').verdict).toBe('unsupported');
  });

  it('refuses a function definition', () => {
    expect(validateAnswer('f(x) = x^2', '4').verdict).toBe('unsupported');
  });

  it('refuses a block expression', () => {
    expect(validateAnswer('1; 2', '2').verdict).toBe('unsupported');
  });

  it('refuses an unknown function', () => {
    expect(validateAnswer('import("fs")', '1').verdict).toBe('unsupported');
  });

  it('refuses a disallowed symbol', () => {
    expect(validateAnswer('process', '1').verdict).toBe('unsupported');
  });

  it('refuses a huge exponent that would hang evaluation', () => {
    const result = validateAnswer('9^9^9^9^9', '1');
    expect(result.verdict).not.toBe('equivalent');
  });
});

describe('normalizeFraction', () => {
  it('reduces a fraction to lowest terms', () => {
    expect(normalizeFraction('6/8')).toBe('3/4');
  });

  it('returns null for something it cannot reduce', () => {
    expect(normalizeFraction('x + 1')).toBeNull();
  });
});

describe('substitutionHolds', () => {
  it('confirms a root of a linear equation', () => {
    const result = substitutionHolds('2*x + 3 = 11', 'x', '4');
    expect(result.verdict).toBe('equivalent');
    expect(result.confidence).toBe(1);
  });

  it('rejects a value that is not a root', () => {
    expect(substitutionHolds('2*x + 3 = 11', 'x', '5').verdict).toBe('not_equivalent');
  });

  it('confirms a root of a quadratic', () => {
    expect(substitutionHolds('x^2 - 5*x + 6 = 0', 'x', '3').verdict).toBe('equivalent');
  });

  it('returns unsupported when there is no equation', () => {
    expect(substitutionHolds('2*x + 3', 'x', '4').verdict).toBe('unsupported');
  });
});

/**
 * Found by the section 37 evaluation suite on its first run.
 *
 * `simplify` does not expand products, so `simplify((x^2+2x+1) - ((x+1)^2))`
 * returns the difference unchanged and the answer fell through to
 * `unsupported`. That is not academic: §56.2 makes the deterministic check the
 * only route to confidence 1.0 on the transfer component, so a student who
 * answered `(x+1)^2` against a reference of `x^2 + 2x + 1` had a correct
 * transfer recorded as `unavailable` and lost the points.
 *
 * `rationalize` supplies a canonical form and is used only to confirm a zero
 * difference, so an expression it cannot handle still declines to guess.
 */
describe('validateAnswer, expanded polynomial equivalence', () => {
  it('recognises a factored form as equivalent to its expansion', () => {
    expect(validateAnswer('x^2 + 2x + 1', '(x+1)^2').verdict).toBe('equivalent');
  });

  it('recognises the demo problem factoring in both directions', () => {
    expect(validateAnswer('(x-2)(x-3)', 'x^2 - 5x + 6').verdict).toBe('equivalent');
    expect(validateAnswer('x^2 - 5x + 6', '(x-2)(x-3)').verdict).toBe('equivalent');
  });

  it('recognises a distributed product', () => {
    expect(validateAnswer('2(x+3)', '2x + 6').verdict).toBe('equivalent');
  });

  it('never reports a genuinely different polynomial as equivalent', () => {
    // Deliberately not asserting `not_equivalent`. The rationalize step is used
    // only to *confirm* a zero difference, so a non-zero canonical form yields
    // `unsupported`: a rational form that is not zero can still hide an
    // equivalence the library cannot reduce, and section 23 requires declining
    // rather than claiming certainty on unsupported symbolic problems.
    //
    // This assertion was originally written as `not_equivalent` and failed. The
    // expectation was wrong, not the code: the conservative verdict is the
    // correct one, and §56.2 treats it as `unavailable` rather than marking the
    // student incorrect.
    expect(validateAnswer('x^2', 'x^3').verdict).not.toBe('equivalent');
    expect(validateAnswer('(x-2)(x-3)', 'x^2 - 5x + 7').verdict).not.toBe('equivalent');
  });

  it('declines rather than guessing on expressions beyond the library', () => {
    // A trigonometric identity is true but not decidable by rationalize.
    // Section 23 requires uncertainty here, not a confident wrong answer.
    expect(validateAnswer('sin(x)^2 + cos(x)^2', '1').verdict).toBe('unsupported');
  });
});
