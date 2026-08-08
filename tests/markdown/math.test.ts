import { describe, expect, it } from 'vitest';
import { decodeLiteralEscapes, normalizeMathDelimiters } from '@/lib/markdown/math';

describe('decodeLiteralEscapes', () => {
  it('converts a literal backslash-n into a real newline', () => {
    // The model double-escaped its JSON, so JSON.parse produced these two
    // characters rather than a line break.
    expect(decodeLiteralEscapes('Step one.\\nStep two.')).toBe('Step one.\nStep two.');
  });

  it('converts a literal escape before a capital letter', () => {
    // The common real-world case: the next character is an ordinary letter, so
    // a naive "not followed by a letter" guard would miss it entirely.
    expect(decodeLiteralEscapes('Try this:\\nFirst step')).toBe('Try this:\nFirst step');
  });

  it('converts a literal blank line into a paragraph break', () => {
    expect(decodeLiteralEscapes('One.\\n\\nTwo.')).toBe('One.\n\nTwo.');
  });

  it('normalizes a literal carriage return and newline pair', () => {
    expect(decodeLiteralEscapes('One.\\r\\nTwo.')).toBe('One.\nTwo.');
  });

  it('leaves LaTeX commands inside inline math untouched', () => {
    const input = 'Since $a \\neq b$ we stop.';
    expect(decodeLiteralEscapes(input)).toBe(input);
  });

  it('leaves LaTeX commands inside display math untouched', () => {
    const input = '$$\n3 \\times 4\n$$';
    expect(decodeLiteralEscapes(input)).toBe(input);
  });

  it('leaves undelimited LaTeX commands untouched', () => {
    // Models sometimes forget the delimiters. Rewriting `\neq` into a newline
    // plus "eq" would be worse than leaving one escape unconverted.
    expect(decodeLiteralEscapes('a \\neq b')).toBe('a \\neq b');
    expect(decodeLiteralEscapes('\\nabla f')).toBe('\\nabla f');
    expect(decodeLiteralEscapes('3 \\times 4')).toBe('3 \\times 4');
  });

  it('leaves code spans untouched', () => {
    expect(decodeLiteralEscapes('```\nkeep\\nliteral\n```')).toBe('```\nkeep\\nliteral\n```');
  });

  it('handles prose and math mixed in one message', () => {
    expect(decodeLiteralEscapes('Line one.\\nSince $x \\neq 2$:\\nDone.')).toBe(
      'Line one.\nSince $x \\neq 2$:\nDone.',
    );
  });

  it('returns an empty string for empty input', () => {
    expect(decodeLiteralEscapes('')).toBe('');
  });
});

describe('normalizeMathDelimiters', () => {
  it('converts inline LaTeX brackets to dollar delimiters', () => {
    expect(normalizeMathDelimiters('The value \\(x^2\\) grows.')).toBe('The value $x^2$ grows.');
  });

  it('converts display LaTeX brackets to double dollar delimiters', () => {
    // remark-math only treats `$$` as display math when the fences are on their own lines.
    expect(normalizeMathDelimiters('\\[x = 2\\]')).toBe('\n\n$$\nx = 2\n$$\n\n');
  });

  it('leaves inline dollar math untouched', () => {
    const input = 'Solve $x^2 - 5x + 6 = 0$ now.';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it('moves same-line block math onto its own lines', () => {
    expect(normalizeMathDelimiters('Formula: $$x = 2$$')).toBe('Formula:\n\n$$\nx = 2\n$$\n\n');
  });

  it('leaves block math that is already on its own lines untouched', () => {
    const input = '$$\nx = 2\n$$';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it('does not rewrite delimiters inside inline code', () => {
    const input = 'Use `\\(a\\)` in LaTeX source.';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it('does not rewrite delimiters inside fenced code blocks', () => {
    const input = '```tex\n\\(a + b\\)\n```';
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  it('handles multiline display math', () => {
    const result = normalizeMathDelimiters('\\[\na + b\n= c\n\\]');
    expect(result).toContain('$$');
    expect(result).toContain('a + b');
  });

  it('returns empty string unchanged', () => {
    expect(normalizeMathDelimiters('')).toBe('');
  });
});
