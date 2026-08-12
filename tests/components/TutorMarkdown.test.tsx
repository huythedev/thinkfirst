/** @vitest-environment jsdom */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TutorMarkdown } from '@/components/TutorMarkdown';

describe('TutorMarkdown chat variant', () => {
  it('keeps real Markdown content on the assistant bubble foreground', () => {
    const { container } = render(
      <div className="assistant-bubble bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-50">
        <TutorMarkdown variant="chat">
          {'# Gợi ý\n\n**Đậm** và *nghiêng*.\n\n- Một\n- Hai\n\n1. Ba\n\n`mã`\n\n```ts\nconst x = 4;\n```\n\n$x^2 + 1$\n\n[Liên kết](https://example.com)'}
        </TutorMarkdown>
      </div>,
    );

    const markdown = container.querySelector('.prose');
    expect(markdown).not.toBeNull();
    expect(markdown?.className).toContain('text-inherit');
    expect(markdown?.className).toContain('prose-p:text-inherit');
    expect(markdown?.className).toContain('prose-li:text-inherit');
    expect(markdown?.className).toContain('prose-strong:text-inherit');
    expect(markdown?.className).toContain('prose-em:text-inherit');
    expect(markdown?.className).toContain('prose-headings:text-inherit');
    expect(markdown?.className).toContain('prose-code:text-inherit');
    expect(markdown?.className).toContain('prose-pre:text-inherit');
    expect(markdown?.className).not.toMatch(/text-(?:muted|foreground-muted)/);
    expect(markdown?.querySelector('p')).not.toBeNull();
    expect(markdown?.querySelector('strong')).not.toBeNull();
    expect(markdown?.querySelector('em')).not.toBeNull();
    expect(markdown?.querySelector('ul')).not.toBeNull();
    expect(markdown?.querySelector('ol')).not.toBeNull();
    expect(markdown?.querySelector('code')).not.toBeNull();
    expect(markdown?.querySelector('.katex')).not.toBeNull();
    expect(markdown?.querySelector('a')).not.toBeNull();
    expect(markdown?.querySelector('h1')).not.toBeNull();
  });

  it('does not change the default Markdown variant used outside chat', () => {
    const { container } = render(<TutorMarkdown>Ordinary content</TutorMarkdown>);
    const markdown = container.querySelector('.prose');
    expect(markdown?.className).not.toContain('text-inherit');
  });
});
