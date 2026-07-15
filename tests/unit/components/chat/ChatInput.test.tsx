import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatInput } from '@/components/chat/ChatInput';

afterEach(cleanup);

function renderInput(overrides: Partial<React.ComponentProps<typeof ChatInput>> = {}) {
  const onWebSearchChange = vi.fn();
  render(
    <ChatInput
      sessionId="session-1"
      isStreaming={false}
      onSendMessage={vi.fn()}
      onStop={vi.fn()}
      webSearchEnabled
      onWebSearchChange={onWebSearchChange}
      webSearchUpdating={false}
      {...overrides}
    />,
  );
  return { onWebSearchChange };
}

describe('ChatInput web search mode', () => {
  it('shows the controlled persistent web mode and local-first warning', () => {
    const { onWebSearchChange } = renderInput();

    const toggle = screen.getByRole('switch', { name: '联网搜索' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByText(
        '优先使用本地知识库；仅本地资料不足时访问管理员授权的网站。联网回答可能需要最多约 2 分钟。',
      ),
    ).toBeTruthy();

    fireEvent.click(toggle);
    expect(onWebSearchChange).toHaveBeenCalledWith(false);
  });

  it('disables the switch while the setting is updating', () => {
    const { onWebSearchChange } = renderInput({ webSearchUpdating: true });

    const toggle = screen.getByRole('switch', { name: '联网搜索' });
    expect(toggle).toHaveProperty('disabled', true);
    fireEvent.click(toggle);
    expect(onWebSearchChange).not.toHaveBeenCalled();
  });
});
