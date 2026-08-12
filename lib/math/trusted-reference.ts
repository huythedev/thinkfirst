/**
 * Derives a reference answer only for a deliberately small, deterministic
 * subset of standalone mathematics: one-variable linear equations.  This is
 * server-side analysis, not a model answer; unsupported problems return null
 * and remain fail-closed at the disclosure boundary.
 */
export function deriveTrustedReferenceAnswer(problem: string, subject: string): string | null {
  if (subject !== 'mathematics' || typeof problem !== 'string') return null;

  const equation = problem
    .replace(/\$+/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/[×·]/g, '*')
    .replace(/^\s*(solve(?:\s+for\s+x)?\s*:?|find\s+x\s*:?)/i, '')
    .trim();
  const pieces = equation.split('=');
  if (pieces.length !== 2) return null;

  const left = parseLinearExpression(pieces[0]);
  const right = parseLinearExpression(pieces[1]);
  if (!left || !right) return null;

  const coefficient = left.x - right.x;
  const constant = right.constant - left.constant;
  if (!Number.isFinite(coefficient) || !Number.isFinite(constant) || coefficient === 0) return null;

  const solution = constant / coefficient;
  if (!Number.isFinite(solution) || Math.abs(solution) > 1e12) return null;
  return `x = ${formatNumber(solution)}`;
}

function parseLinearExpression(raw: string): { x: number; constant: number } | null {
  const compact = raw.replace(/\s+/g, '');
  if (!compact || compact.length > 120 || /[^0-9xX+\-*.]/.test(compact)) return null;

  const terms = compact.replace(/-/g, '+-').split('+').filter(Boolean);
  if (terms.length === 0) return null;
  let x = 0;
  let constant = 0;

  for (const term of terms) {
    if (/x/i.test(term)) {
      if (!/^[+-]?(?:(?:\d+(?:\.\d+)?)\*?)?[xX]$/.test(term)) return null;
      const coefficientText = term.replace(/[xX*]/g, '');
      const coefficient = coefficientText === '' || coefficientText === '+'
        ? 1
        : coefficientText === '-'
          ? -1
          : Number(coefficientText);
      if (!Number.isFinite(coefficient)) return null;
      x += coefficient;
    } else {
      if (!/^[+-]?\d+(?:\.\d+)?$/.test(term)) return null;
      const value = Number(term);
      if (!Number.isFinite(value)) return null;
      constant += value;
    }
  }
  return { x, constant };
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 1e10) / 1e10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
