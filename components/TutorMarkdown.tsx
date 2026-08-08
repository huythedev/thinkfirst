'use client';

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import { decodeLiteralEscapes, normalizeMathDelimiters } from '@/lib/markdown/math';
import 'katex/dist/katex.min.css';

interface TutorMarkdownProps {
  children: string;
  className?: string;
}

/**
 * Renders tutor output as markdown with LaTeX support.
 *
 * The tutor system prompt instructs the model to emit inline math as $...$ and
 * display math as $$...$$, so remark-math and rehype-katex are required for
 * that output to render as math instead of literal dollar signs.
 *
 * Two separate newline problems are handled here. First, the model sometimes
 * double-escapes its JSON, so `decodeLiteralEscapes` turns a literal `\n` back
 * into a real newline. Second, markdown treats a single newline as a soft
 * break that HTML collapses into a space, so `remark-breaks` renders it as a
 * real `<br>`. Without both, tutor steps written one per line run together.
 */
export function TutorMarkdown({ children, className }: TutorMarkdownProps) {
  return (
    <div
      className={
        className ??
        'prose prose-sm max-w-none prose-p:leading-relaxed prose-pre:p-0 break-words'
      }
    >
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false, output: 'htmlAndMathml' }]]}
      >
        {normalizeMathDelimiters(decodeLiteralEscapes(children ?? ''))}
      </Markdown>
    </div>
  );
}

export default TutorMarkdown;
