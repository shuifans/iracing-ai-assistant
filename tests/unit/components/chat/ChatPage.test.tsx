import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const push = vi.fn();
const router = { push };

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/auth-client', () => ({ authFetch: vi.fn() }));

import { authFetch } from '@/lib/auth-client';
import ChatPage from '@/app/(app)/chat/page';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function submitQuestion() {
  fireEvent.change(screen.getByLabelText('消息输入'), { target: { value: 'How do I brake?' } });
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
}

describe('ChatPage first-message web search mode', () => {
  beforeEach(() => {
    vi.mocked(authFetch).mockReset();
    push.mockReset();
    sessionStorage.clear();
  });

  afterEach(cleanup);

  it('starts with an interactive Web switch off', () => {
    render(<ChatPage />);

    const toggle = screen.getByRole('switch', { name: '联网搜索' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle).toHaveProperty('disabled', false);
  });

  it('sends the first message without PATCH when Web mode stays off', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(
      jsonResponse({ data: { id: 'local-session' } }, 201),
    );

    render(<ChatPage />);
    submitQuestion();

    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/local-session'));
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem('pending-message-local-session') ?? '{}')).toEqual({
      content: 'How do I brake?',
      attachmentIds: [],
    });
  });

  it('persists enabled Web mode before exposing the first message to the session page', async () => {
    const patchResult = deferred<Response>();
    vi.mocked(authFetch)
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'new-session' } }, 201))
      .mockReturnValueOnce(patchResult.promise);

    render(<ChatPage />);
    fireEvent.click(screen.getByRole('switch', { name: '联网搜索' }));
    submitQuestion();

    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(2));
    expect(authFetch).toHaveBeenNthCalledWith(1, '/api/chat/sessions', { method: 'POST' });
    expect(authFetch).toHaveBeenNthCalledWith(2, '/api/chat/sessions/new-session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webSearchEnabled: true }),
    });
    expect(screen.getByRole('switch', { name: '联网搜索' })).toHaveProperty('disabled', true);
    expect(sessionStorage.getItem('pending-message-new-session')).toBeNull();
    expect(push).not.toHaveBeenCalled();

    patchResult.resolve(jsonResponse({ data: { id: 'new-session', webSearchEnabled: true } }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/new-session'));
    expect(JSON.parse(sessionStorage.getItem('pending-message-new-session') ?? '{}')).toEqual({
      content: 'How do I brake?',
      attachmentIds: [],
    });
  });

  it('stops before sending and preserves the selection when Web persistence fails', async () => {
    vi.mocked(authFetch)
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'new-session' } }, 201))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'SERVICE_NOT_READY', message: '暂时无法开启联网搜索' } },
          503,
        ),
      );

    render(<ChatPage />);
    fireEvent.click(screen.getByRole('switch', { name: '联网搜索' }));
    submitQuestion();

    expect(await screen.findByText('暂时无法开启联网搜索')).toBeTruthy();
    const toggle = screen.getByRole('switch', { name: '联网搜索' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle).toHaveProperty('disabled', false);
    expect(sessionStorage.getItem('pending-message-new-session')).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});
