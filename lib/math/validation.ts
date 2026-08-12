import { evaluate, fraction, format, parse, rationalize, simplify, type MathNode } from 'mathjs';

/**
 * Mathematical validation, per section 23 of
 * `instructions/04_MODEL_PROMPTS_AND_VALIDATION.md`.
 *
 * "Do not rely solely on the generative model to verify its own output." This is
 * also the load-bearing dependency of §56.2's transfer component: a deterministic
 * check is the *only* path that earns confidence 1.0, and without one the
 * component is `unavailable` rather than worth 30 points.
 *
 * Two constraints shape the implementation:
 *
 * - Section 23 says to use a maintained mathematics library. That is `mathjs`.
 * - Section 23 also says to avoid executing arbitrary user-provided code. Student
 *   answers are untrusted input, so every expression is parsed first and rejected
 *   unless every node in the tree is on an allowlist. `evaluate` never sees a
 *   string that has not passed that check.
 */

/** Relative tolerance for numeric comparison. Tight enough to catch real errors. */
const RELATIVE_TOLERANCE = 1e-9;
const ABSOLUTE_TOLERANCE = 1e-12;

/** Expressions longer than this are refused rather than parsed. */
const MAX_EXPRESSION_LENGTH = 200;

/**
 * Node types a student answer may contain. Deliberately excludes
 * `FunctionAssignmentNode`, `AssignmentNode` and `BlockNode`, which are how a
 * mathjs expression turns into something that mutates scope or loops.
 */
const ALLOWED_NODE_TYPES = new Set([
  'ConstantNode',
  'OperatorNode',
  'ParenthesisNode',
  'UnaryMinusNode',
  'FunctionNode',
  'SymbolNode',
]);

/** Functions a student answer may call. Everything else is refused. */
const ALLOWED_FUNCTIONS = new Set([
  'abs',
  'sqrt',
  'cbrt',
  'exp',
  'log',
  'log2',
  'log10',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'sinh',
  'cosh',
  'tanh',
  'round',
  'floor',
  'ceil',
  'min',
  'max',
  'pow',
  'gcd',
  'lcm',
  'factorial',
  'fraction',
  'nthRoot',
]);

/** Symbols that may appear as free names: mathematical constants only. */
const ALLOWED_SYMBOLS = new Set(['pi', 'e', 'tau', 'PI', 'E']);

/**
 * Free variable names a student answer may contain, so `2*x + 2` can be compared
 * symbolically against `2*(x + 1)`. Deliberately narrow: a single letter with an
 * optional digit. A free symbol cannot execute anything on its own -- mathjs
 * raises "undefined symbol" -- but keeping the set small also keeps prose from
 * being mistaken for algebra.
 */
const VARIABLE_NAME = /^[a-zA-Z][0-9]?$/;

/** Expressions with more nodes than this are refused rather than evaluated. */
const MAX_NODE_COUNT = 60;

function isAllowedSymbol(name: string | undefined): boolean {
  if (!name) return false;
  return ALLOWED_SYMBOLS.has(name) || VARIABLE_NAME.test(name);
}

export type ValidationVerdict = 'equivalent' | 'not_equivalent' | 'unsupported';

export interface ValidationResult {
  verdict: ValidationVerdict;
  /** 1 for a deterministic decision, 0 when the check could not be performed. */
  confidence: number;
  /** Plain-language note, safe to store. Never contains raw error text. */
  detail: string;
  method: 'numeric' | 'fraction' | 'symbolic' | 'text' | 'none';
}

const UNSUPPORTED: ValidationResult = {
  verdict: 'unsupported',
  confidence: 0,
  detail: 'This answer could not be checked deterministically.',
  method: 'none',
};

/**
 * Strips the presentational wrapping students and models both produce: a leading
 * "x =", LaTeX delimiters, thousands separators, trailing units and prose.
 *
 * Returns the bare expression, or null when nothing usable remains.
 */
export function normalizeAnswer(input: string): string | null {
  if (typeof input !== 'string') return null;

  let text = input.trim();
  if (text.length === 0 || text.length > MAX_EXPRESSION_LENGTH) return null;

  // LaTeX wrappers and inline math markers.
  text = text
    .replace(/\$+/g, '')
    .replace(/\\left|\\right/g, '')
    .replace(/\\[()[\]]/g, '')
    .replace(/\\dfrac|\\tfrac|\\frac/g, 'frac')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\div/g, '/')
    .replace(/\\sqrt/g, 'sqrt')
    .replace(/\\pi/g, 'pi');

  // `frac{a}{b}` -> `(a)/(b)`, applied repeatedly for nested fractions.
  let previous: string;
  do {
    previous = text;
    text = text.replace(/frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)');
  } while (text !== previous);

  text = text.replace(/^đáp án( cuối cùng)?( là)?\s*/i, '');
  text = text.replace(/^dap an( cuoi cung)?( la)?\s*/i, '');
  text = text.replace(/^the answer is\s*/i, '');
  text = text.replace(/^the correct result is\s*/i, '');
  text = text.replace(/^your answer\s*/i, '');
  text = text.replace(/\s*is correct$/i, '');
  
  // Drop a leading assignment such as "x =" or "answer:".
  text = text.replace(/^[A-Za-z_][A-Za-z0-9_]*\s*(=|:|∈)\s*/, '');
  // Drop repeated assignments in compounds, e.g. "2 or x = 3" -> "2 or 3"
  text = text.replace(/\bor\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*/g, 'or ');
  
  // Thousands separators between digits only, e.g. "1,234" or "12,500".
  let previousThousands: string;
  do {
    previousThousands = text;
    text = text.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
  } while (text !== previousThousands);

  // Set notation like {2, 3} -> convert commas inside braces to 'or', then unwrap braces.
  text = text.replace(/\\in\s*/g, '');
  text = text.replace(/∈\s*/g, '');
  text = text.replace(/\{([^}]+)\}/g, (_, inner) => inner.replace(/,/g, ' or '));
  text = text.replace(/\bhoac\b/gi, 'or');
  text = text.replace(/\bhoặc\b/gi, 'or');
  text = text.replace(/\.$/, '');

  // Convert commas outside parentheses to 'or' (e.g. for "x = 2, x = 3" or "2, 3" but not inside functions like min(2, 3)).
  let inParen = 0;
  let newText = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '(' || char === '[') inParen++;
    else if (char === ')' || char === ']') inParen = Math.max(0, inParen - 1);

    if (char === ',' && inParen === 0) {
      newText += ' or ';
    } else {
      newText += char;
    }
  }
  text = newText;

  // Percentages become their fractional value.
  text = text.replace(/([0-9.]+)\s*%/g, '($1/100)');

  // Trailing unit words or prose. Kept conservative: only strips an alphabetic
  // tail that follows a digit or a closing bracket.
  text = text.replace(/([0-9)\]])\s*[A-Za-z][A-Za-z^/\s.]*$/, '$1');

  text = text.trim();
  return text.length === 0 ? null : text;
}

/** `parse` is overloaded for arrays, so the node type is named explicitly. */
type ParsedNode = MathNode;

/**
 * Walks the tree explicitly rather than through `node.forEach`.
 *
 * The first implementation used `forEach` and rejected every function call,
 * because mathjs represents a `FunctionNode`'s callee as a child `SymbolNode`
 * named `sqrt`, which then failed the free-symbol check. Walking by hand lets the
 * callee be validated against `ALLOWED_FUNCTIONS` and skipped as a symbol.
 */
function isAllowedTree(node: ParsedNode, budget: { remaining: number }): boolean {
  if (budget.remaining <= 0) return false;
  budget.remaining -= 1;

  if (!ALLOWED_NODE_TYPES.has(node.type)) return false;

  if (node.type === 'SymbolNode') {
    return isAllowedSymbol((node as unknown as { name?: string }).name);
  }

  if (node.type === 'FunctionNode') {
    const functionNode = node as unknown as { fn?: { name?: string }; args?: ParsedNode[] };
    if (!functionNode.fn?.name || !ALLOWED_FUNCTIONS.has(functionNode.fn.name)) return false;
    return (functionNode.args ?? []).every((argument) => isAllowedTree(argument, budget));
  }

  // An exponent tower such as `9^9^9^9^9` parses and passes every allowlist check,
  // then hangs `evaluate` on bignum arithmetic. Bounding a constant exponent keeps
  // validation a bounded computation, which untrusted input requires.
  if (node.type === 'OperatorNode') {
    const operatorNode = node as unknown as { op?: string; args?: ParsedNode[] };
    const args = operatorNode.args ?? [];
    if (operatorNode.op === '^') {
      const exponent = args[1];
      if (exponent === undefined) return false;
      if (exponent.type !== 'ConstantNode') {
        // A symbolic exponent is fine; it is never numerically evaluated here.
        if (!args.every((argument) => isAllowedTree(argument, budget))) return false;
        return true;
      }
      const value = Number((exponent as unknown as { value?: unknown }).value);
      if (!Number.isFinite(value) || Math.abs(value) > 1000) return false;
    }
    return args.every((argument) => isAllowedTree(argument, budget));
  }

  const children: ParsedNode[] = [];
  node.forEach((child) => {
    children.push(child);
  });
  return children.every((child) => isAllowedTree(child, budget));
}

/**
 * Parses and refuses anything outside the allowlist. This is the guard that keeps
 * section 23's "avoid executing arbitrary user-provided code" true: `evaluate`
 * never sees a string that has not passed through here.
 */
function parseSafely(expression: string): ParsedNode | null {
  let tree: ParsedNode;
  try {
    tree = parse(expression) as ParsedNode;
  } catch {
    return null;
  }

  return isAllowedTree(tree, { remaining: MAX_NODE_COUNT }) ? tree : null;
}

function toNumber(expression: string): number | null {
  const tree = parseSafely(expression);
  if (tree === null) return null;

  try {
    const value = tree.evaluate();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    // mathjs returns Fraction and BigNumber objects for some inputs.
    if (value !== null && typeof value === 'object' && 'toNumber' in value) {
      const numeric = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(numeric) ? numeric : null;
    }
    return null;
  } catch {
    return null;
  }
}

function numbersMatch(left: number, right: number): boolean {
  const difference = Math.abs(left - right);
  if (difference <= ABSOLUTE_TOLERANCE) return true;
  const scale = Math.max(Math.abs(left), Math.abs(right));
  return difference <= RELATIVE_TOLERANCE * scale;
}

/**
 * True when the tree contains a free variable, so symbolic comparison is the
 * right tool for it.
 *
 * This gate matters for more than tidiness. `9^9^9^9^9` overflows to Infinity
 * numerically, so `toNumber` returns null and the expression used to fall through
 * to `simplify`, where mathjs switches to exact rational arithmetic and hangs --
 * measured at over 7 seconds before the test timed out. A constant expression
 * that cannot be evaluated numerically is `unsupported`; it is never a candidate
 * for algebraic reduction.
 */
function containsVariable(node: ParsedNode): boolean {
  if (node.type === 'SymbolNode') {
    const name = (node as unknown as { name?: string }).name;
    return Boolean(name) && !ALLOWED_SYMBOLS.has(name!);
  }

  if (node.type === 'FunctionNode') {
    const functionNode = node as unknown as { args?: ParsedNode[] };
    return (functionNode.args ?? []).some(containsVariable);
  }

  let found = false;
  node.forEach((child) => {
    if (containsVariable(child)) found = true;
  });
  return found;
}

/** Fraction normalization, named explicitly by section 23. */
export function normalizeFraction(expression: string): string | null {
  const normalized = normalizeAnswer(expression);
  if (normalized === null) return null;
  if (parseSafely(normalized) === null) return null;

  try {
    return format(fraction(evaluate(normalized)));
  } catch {
    return null;
  }
}

/**
 * Compares a student answer against a reference answer.
 *
 * Numeric comparison with tolerance first, because it decides the common case.
 * Symbolic equivalence second, for answers that are expressions rather than
 * values. Exact text match last, for genuinely non-mathematical answers such as
 * "the function is even".
 *
 * Returns `unsupported` rather than guessing. §56.2 then treats the transfer
 * component as `unavailable`, and a second model pass may be used with lower
 * confidence, exactly as section 23 prescribes.
 */
export function validateAnswer(studentAnswer: string, referenceAnswer: string): ValidationResult {
  const student = normalizeAnswer(studentAnswer);
  const reference = normalizeAnswer(referenceAnswer);

  if (student === null || reference === null) return UNSUPPORTED;

  const studentValue = toNumber(student);
  const referenceValue = toNumber(reference);

  if (studentValue !== null && referenceValue !== null) {
    const equivalent = numbersMatch(studentValue, referenceValue);
    return {
      verdict: equivalent ? 'equivalent' : 'not_equivalent',
      confidence: 1,
      detail: equivalent
        ? 'The value matches the reference answer.'
        : 'The value does not match the reference answer.',
      method: 'numeric',
    };
  }

  // Symbolic: `simplify(a - b)` reducing to zero is equivalence.
  const studentTree = parseSafely(student);
  const referenceTree = parseSafely(reference);

  if (
    studentTree !== null &&
    referenceTree !== null &&
    containsVariable(studentTree) &&
    containsVariable(referenceTree)
  ) {
    try {
      const difference = simplify(`(${student}) - (${reference})`);
      const asString = difference.toString();
      if (asString === '0') {
        return {
          verdict: 'equivalent',
          confidence: 1,
          detail: 'The expression is algebraically equivalent to the reference answer.',
          method: 'symbolic',
        };
      }

      // A non-zero simplification is only conclusive if it is a constant. An
      // expression that still contains a symbol may simply be beyond `simplify`,
      // and claiming certainty there is precisely what section 23 forbids.
      const numeric = Number(asString);
      if (Number.isFinite(numeric)) {
        return {
          verdict: numbersMatch(numeric, 0) ? 'equivalent' : 'not_equivalent',
          confidence: 1,
          detail: 'The difference from the reference answer simplifies to a constant.',
          method: 'symbolic',
        };
      }

      // `simplify` does not expand products, so it cannot see that
      // `x^2 + 2x + 1` and `(x+1)^2` are the same expression -- it returns the
      // difference unchanged and the answer falls through to `unsupported`.
      // That is a real cost rather than a curiosity: §56.2 makes the
      // deterministic check the only route to confidence 1.0 on the transfer
      // component, so a student who correctly answered `(x+1)^2` when the
      // reference says `x^2 + 2x + 1` had their transfer scored `unavailable`.
      //
      // `rationalize` puts a rational expression into a canonical form, which
      // decides the polynomial cases exactly. It is used only to *confirm* a
      // zero difference: anything else falls through, because a non-zero
      // rational form can still hide an equivalence beyond the library, and
      // section 23 says to avoid claiming certainty on unsupported symbolic
      // problems.
      const canonical = rationalize(`(${student}) - (${reference})`).toString();
      if (canonical === '0') {
        return {
          verdict: 'equivalent',
          confidence: 1,
          detail: 'The expression is algebraically equivalent to the reference answer.',
          method: 'symbolic',
        };
      }
    } catch {
      // Fall through to the text comparison.
    }
  }

  const studentText = student.replace(/\s+/g, ' ').toLowerCase();
  const referenceText = reference.replace(/\s+/g, ' ').toLowerCase();
  if (studentText === referenceText) {
    return {
      verdict: 'equivalent',
      confidence: 1,
      detail: 'The answer matches the reference answer exactly.',
      method: 'text',
    };
  }

  return UNSUPPORTED;
}

/**
 * Equation substitution, named by section 23: checks that a claimed root
 * satisfies an equation by substituting it back in.
 */
export function substitutionHolds(
  equation: string,
  variable: string,
  value: string,
): ValidationResult {
  const sides = equation.split('=');
  if (sides.length !== 2) return UNSUPPORTED;

  const candidate = normalizeAnswer(value);
  if (candidate === null) return UNSUPPORTED;

  const candidateValue = toNumber(candidate);
  if (candidateValue === null) return UNSUPPORTED;

  const evaluateSide = (side: string): number | null => {
    const normalized = normalizeAnswer(side);
    if (normalized === null) return null;

    // The variable is substituted textually *before* parsing, so the parsed tree
    // still contains no free symbols and the allowlist check stays meaningful.
    const substituted = normalized.replace(
      new RegExp(`\\b${variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'),
      `(${candidateValue})`,
    );
    return toNumber(substituted);
  };

  const left = evaluateSide(sides[0]);
  const right = evaluateSide(sides[1]);

  if (left === null || right === null) return UNSUPPORTED;

  const holds = numbersMatch(left, right);
  return {
    verdict: holds ? 'equivalent' : 'not_equivalent',
    confidence: 1,
    detail: holds
      ? 'Substituting the value satisfies the equation.'
      : 'Substituting the value does not satisfy the equation.',
    method: 'numeric',
  };
}
