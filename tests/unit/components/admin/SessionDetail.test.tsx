import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SessionDetail } from '@/components/admin/SessionDetail';

afterEach(cleanup);

const session = {
  id: 'session-123456789',
  title: 'Reviewed session',
  status: 'active',
  userId: 'user-123456789',
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
  lastMessageAt: '2026-07-14T00:00:00.000Z',
};

function assistantMessage(content: string) {
  return {
    id: 'message-1',
    role: 'assistant',
    status: 'complete',
    content,
    createdAt: '2026-07-14T00:00:00.000Z',
  };
}

describe('SessionDetail Markdown rendering', () => {
  it('renders ordinary headings, code, tables, and safe links', () => {
    const content = [
      '## Race review',
      '',
      '```text',
      'Lap 4: clean pass',
      '```',
      '',
      '| Lap | Note |',
      '| --- | --- |',
      '| 4 | Clean |',
      '',
      '[Replay](http://example.com/replay)',
    ].join('\n');

    const { container } = render(
      <SessionDetail session={session} messages={[assistantMessage(content)]} onClose={vi.fn()} />,
    );

    expect(screen.getByRole('heading', { name: 'Race review' })).toBeTruthy();
    expect(container.querySelector('pre code')?.textContent).toContain('Lap 4: clean pass');
    expect(container.querySelector('table')?.textContent).toContain('Clean');
    const link = screen.getByRole('link', { name: 'Replay' });
    expect(link.getAttribute('href')).toBe('http://example.com/replay');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('does not expose raw HTML or event handlers', () => {
    const content = [
      '<img src=x onerror="window.__markdownXss = true">',
      '<svg onload="window.__markdownXss = true"><script>window.__markdownXss = true</script></svg>',
      '[quote-break](https://example.com/\" onmouseover=\"window.__markdownXss=true)',
    ].join('\n');

    const { container } = render(
      <SessionDetail session={session} messages={[assistantMessage(content)]} onClose={vi.fn()} />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg[onload]')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onerror], [onmouseover]')).toBeNull();
  });
});
