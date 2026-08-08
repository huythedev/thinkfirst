/**
 * LaTeX commands that begin with `\n` or `\t` and could plausibly appear in
 * tutor output that the model forgot to wrap in math delimiters. Inside proper
 * `$...$` spans this does not matter, because those are skipped wholesale, but
 * undelimited math is a common model slip and rewriting `\neq` into a newline
 * followed by "eq" would be worse than leaving one escape unconverted.
 */
const LATEX_COMMANDS_AFTER_ESCAPE =
  /^(?:eq|e|abla|u|i|otin|leq|geq|subseteq|supseteq|parallel|mid|times|theta|to|text|tan|tau|tfrac|triangle|top|imes)\b/;

/**
 * Models sometimes double-escape their JSON string fields, so `JSON.parse`
 * yields a literal backslash followed by `n` instead of a newline. Markdown
 * then prints that verbatim as `\n` in the middle of a sentence.
 *
 * Math spans are skipped wholesale by the caller, so the only ambiguity left is
 * undelimited LaTeX. A short blocklist of real commands covers that; everything
 * else converts, because `\n` in prose is overwhelmingly an escaped newline.
 * Guarding against every letter would be wrong: the most common case of all is
 * `\nStep two`, where the following character is an ordinary capital letter.
 */
function unescapeOutsideMath(segment: string): string {
  return segment
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, (match, offset: number) =>
      LATEX_COMMANDS_AFTER_ESCAPE.test(segment.slice(offset + 2)) ? match : '\n',
    )
    .replace(/\\t/g, (match, offset: number) =>
      LATEX_COMMANDS_AFTER_ESCAPE.test(segment.slice(offset + 2)) ? match : '\t',
    );
}

/**
 * Splits on math spans and fenced/inline code, then unescapes only the prose
 * between them. `$...$`, `$$...$$`, `\(...\)` and `\[...\]` are all preserved
 * byte for byte so KaTeX receives exactly what the model wrote.
 */
export function decodeLiteralEscapes(source: string): string {
  if (!source) return '';

  const segments = source.split(
    /(```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]*?\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g,
  );

  return segments
    .map((segment, index) => (index % 2 === 1 ? segment : unescapeOutsideMath(segment)))
    .join('');
}

/**
 * Models drift between `$...$` and `\(...\)` delimiters even when the prompt
 * asks for one style. remark-math only understands the dollar form, so the
 * LaTeX bracket form is rewritten before parsing. Fenced code and inline code
 * are left untouched so code samples never get mangled.
 *
 * remark-math only produces display math when the `$$` fences sit on their own
 * lines, so block math is emitted with real line breaks rather than inline.
 */
export function normalizeMathDelimiters(source: string): string {
  if (!source) return '';

  const segments = source.split(/(```[\s\S]*?```|`[^`\n]*`)/g);

  return segments
    .map((segment, index) => {
      const isCode = index % 2 === 1;
      if (isCode) return segment;

      return segment
        .replace(/\\\[([\s\S]+?)\\\]/g, (_match, body) => `\n\n$$\n${body.trim()}\n$$\n\n`)
        .replace(
          /(^|[^$\n])\$\$([^$\n]+?)\$\$(?=$|[^$])/gm,
          (_match, before: string, body: string) => `${before.replace(/[ \t]+$/, '')}\n\n$$\n${body.trim()}\n$$\n\n`,
        )
        .replace(/\\\(([\s\S]+?)\\\)/g, (_match, body) => `$${body}$`);
    })
    .join('');
}
