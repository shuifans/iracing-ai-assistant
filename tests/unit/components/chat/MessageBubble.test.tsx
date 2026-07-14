import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessageBubble } from '@/components/chat/MessageBubble';
import type { ChatMessage } from '@/modules/chat/types';

afterEach(cleanup);

function assistantMessage(content: string): ChatMessage {
  return {
    id: 'message-1',
    role: 'assistant',
    status: 'streaming',
    content,
    createdAt: '2026-07-14T00:00:00.000Z',
  };
}

describe('MessageBubble Markdown rendering', () => {
  it('renders ordinary headings, code, tables, and safe links', () => {
    const content = [
      '# Setup guide',
      '',
      '`const grip = true`',
      '',
      '| Setting | Value |',
      '| --- | --- |',
      '| Brake bias | 54% |',
      '',
      '[Read more](https://example.com/guide)',
    ].join('\n');

    const { container } = render(<MessageBubble message={assistantMessage(content)} />);

    expect(screen.getByRole('heading', { name: 'Setup guide' })).toBeTruthy();
    expect(container.querySelector('code')?.textContent).toBe('const grip = true');
    expect(container.querySelector('table')?.textContent).toContain('Brake bias');
    const link = screen.getByRole('link', { name: 'Read more' });
    expect(link.getAttribute('href')).toBe('https://example.com/guide');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('makes dangerous link schemes inert', () => {
    const content = [
      '[script](JaVaScRiPt:alert(1))',
      '[spaced](  javascript:alert(1))',
      '[entity](java&#x73;cript:alert(1))',
      '[data](data:text/html,<script>alert(1)</script>)',
      '[vbscript](vbscript:msgbox(1))',
    ].join('\n');

    render(<MessageBubble message={assistantMessage(content)} />);

    for (const name of ['script', 'spaced', 'entity', 'data', 'vbscript']) {
      const link = screen.queryByRole('link', { name });
      expect(link?.getAttribute('href') ?? null).toBeNull();
    }
  });
});
