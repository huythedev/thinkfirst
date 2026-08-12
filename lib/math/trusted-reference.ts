/**
 * Derive server-only reference answers for a deliberately small algebra grammar.
 * This is not a CAS: there is no evaluation, expansion, function support, or
 * guessing.  Unsupported input is intentionally indistinguishable from no
 * reference at the caller boundary.
 */
export function deriveTrustedReferenceAnswer(problem: string, subject: string): string | null {
  if (subject !== 'mathematics' || typeof problem !== 'string') return null;

  const equation = normalizeEquation(problem);
  if (!equation) return null;
  const pieces = equation.split('=');
  if (pieces.length !== 2) return null;

  const left = parsePolynomial(pieces[0]);
  const right = parsePolynomial(pieces[1]);
  if (!left || !right) return null;

  const a = left.quadratic - right.quadratic;
  const b = left.linear - right.linear;
  const c = left.constant - right.constant;
  if (![a, b, c].every(isSafeCoefficient)) return null;

  // Keep the established linear support, while extending it to degree two.
  if (a === 0) {
    if (b === 0) return null;
    const root = -c / b;
    return isSafeCoefficient(root) ? `x = ${formatNumber(root)}` : null;
  }

  const discriminant = b * b - 4 * a * c;
  if (!isSafeCoefficient(discriminant) || discriminant < 0) return null;
  if (discriminant === 0) {
    const root = -b / (2 * a);
    return isSafeCoefficient(root) ? `x = ${formatNumber(root)}` : null;
  }

  // Integer coefficients retain a compact exact surd whenever possible.
  // Square-factor extraction is intentionally bounded; larger discriminants
  // still receive a finite numeric representation rather than an unbounded
  // factorisation attempt on request input.
  if ([a, b, c].every(Number.isInteger) && Number.isSafeInteger(discriminant) && discriminant <= 100_000_000) {
    const exact = formatExactQuadraticRoots(a, b, discriminant);
    if (exact) return exact;
  }

  const squareRoot = Math.sqrt(discriminant);
  const first = (-b - squareRoot) / (2 * a);
  const second = (-b + squareRoot) / (2 * a);
  if (!isSafeCoefficient(first) || !isSafeCoefficient(second)) return null;
  return `x = ${formatNumber(Math.min(first, second))} or x = ${formatNumber(Math.max(first, second))}`;
}

type Polynomial = { quadratic: number; linear: number; constant: number };

function normalizeEquation(problem: string): string | null {
  const value = problem
    .replace(/\$+/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/[×·]/g, '*')
    .replace(/x²/gi, 'x^2')
    .replace(/^\s*(solve(?:\s+for\s+x)?\s*:?|find\s+x\s*:?)/i, '')
    .replace(/[.?!]+\s*$/, '')
    .trim();
  if (!value || value.length > 160) return null;
  // This is intentionally a lexical gate before term parsing. In particular it
  // rejects identifiers, functions, parentheses, and implicit operations we do
  // not explicitly implement.
  return /^[0-9xX+\-*.=\s^]+$/.test(value) ? value : null;
}

function parsePolynomial(raw: string): Polynomial | null {
  const compact = raw.replace(/\s+/g, '');
  if (!compact || compact.length > 120 || /[+-]$/.test(compact) || /\+\+|--|\+-|-\+/.test(compact)) return null;
  const terms = compact.replace(/-/g, '+-').split('+').filter(Boolean);
  if (terms.length === 0 || terms.length > 20) return null;

  const result: Polynomial = { quadratic: 0, linear: 0, constant: 0 };
  for (const term of terms) {
    const match = term.match(/^([+-]?(?:(?:\d+(?:\.\d+)?)\*?)?)(x(?:\^2)?)?$/i);
    if (!match) return null;
    const [, coefficientText, variable] = match;
    if (!variable && !/^[+-]?\d+(?:\.\d+)?$/.test(coefficientText)) return null;
    const coefficient = coefficientText === '' || coefficientText === '+' ? 1
      : coefficientText === '-' ? -1 : Number(coefficientText.replace(/\*$/, ''));
    if (!isSafeCoefficient(coefficient)) return null;
    if (!variable) result.constant += coefficient;
    else if (variable.toLowerCase() === 'x^2') result.quadratic += coefficient;
    else result.linear += coefficient;
  }
  return [result.quadratic, result.linear, result.constant].every(isSafeCoefficient) ? result : null;
}

function isSafeCoefficient(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= 1e12;
}

function formatExactQuadraticRoots(a: number, b: number, discriminant: number): string | null {
  const denominator = 2 * a;
  if (!Number.isSafeInteger(denominator) || denominator === 0 || discriminant <= 0) return null;
  const root = Math.sqrt(discriminant);
  if (Number.isInteger(root)) {
    const first = formatFraction(-b - root, denominator);
    const second = formatFraction(-b + root, denominator);
    return `x = ${first} or x = ${second}`;
  }

  const { factor, remainder } = extractSquareFactor(discriminant);
  let numerator = -b;
  let surdFactor = factor;
  let reducedDenominator = denominator;
  const divisor = gcd(gcd(Math.abs(numerator), Math.abs(surdFactor)), Math.abs(reducedDenominator));
  numerator /= divisor;
  surdFactor /= divisor;
  reducedDenominator /= divisor;
  if (reducedDenominator < 0) {
    numerator *= -1;
    surdFactor *= -1;
    reducedDenominator *= -1;
  }
  const surd = surdFactor === 1 ? `sqrt(${remainder})` : `${surdFactor}*sqrt(${remainder})`;
  return `x = ${formatSurd(numerator, '-', surd, reducedDenominator)} or x = ${formatSurd(numerator, '+', surd, reducedDenominator)}`;
}

function extractSquareFactor(value: number): { factor: number; remainder: number } {
  let remainder = value;
  let factor = 1;
  for (let divisor = 2; divisor * divisor <= remainder; divisor += 1) {
    while (remainder % (divisor * divisor) === 0) {
      remainder /= divisor * divisor;
      factor *= divisor;
    }
  }
  return { factor, remainder };
}

function formatSurd(numerator: number, operator: '+' | '-', surd: string, denominator: number): string {
  const expression = numerator === 0 ? `${operator === '-' ? '-' : ''}${surd}` : `${numerator} ${operator} ${surd}`;
  return denominator === 1 ? expression : `(${expression})/${denominator}`;
}

function formatFraction(numerator: number, denominator: number): string {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) return '';
  const divisor = gcd(Math.abs(numerator), Math.abs(denominator));
  const top = numerator / divisor;
  const bottom = denominator / divisor;
  if (bottom === 1) return String(top);
  if (bottom === -1) return String(-top);
  return `${top}/${bottom}`;
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 1e10) / 1e10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
