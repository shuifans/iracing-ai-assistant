import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

let currentSessionId = 'session-1';
const replace = vi.fn();
const router = { replace };

vi.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: currentSessionId }),
  useRouter: () => router,
}));
vi.mock('@/lib/auth-client', () => ({
  authFetch: vi.fn(),
  getAccessToken: vi.fn(() => null),
}));

import { authFetch } from '@/lib/auth-client';
import SessionPage from '@/app/(app)/chat/[sessionId]/page';

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

function sessionResponse(id: string, webSearchEnabled: boolean) {
  return jsonResponse({
    data: {
      session: { id, webSearchEnabled },
      messages: [],
    },
  });
}

describe('SessionPage persistent web search mode', () => {
  beforeEach(() => {
    currentSessionId = 'session-1';
    replace.mockReset();
    vi.mocked(authFetch).mockReset();
    sessionStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(cleanup);

  it('initializes from GET and persists a change while locking the switch', async () => {
    const patchResult = deferred<Response>();
    vi.mocked(authFetch)
      .mockResolvedValueOnce(sessionResponse('session-1', true))
      .mockReturnValueOnce(patchResult.promise);

    render(<SessionPage />);

    const toggle = await screen.findByRole('switch', { name: '联网搜索' });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(toggle);

    expect(toggle).toHaveProperty('disabled', true);
    expect(authFetch).toHaveBeenLastCalledWith('/api/chat/sessions/session-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webSearchEnabled: false }),
      signal: expect.any(AbortSignal),
    });

    patchResult.resolve(jsonResponse({ data: { id: 'session-1', webSearchEnabled: false } }));
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      expect(toggle).toHaveProperty('disabled', false);
    });
  });

  it('keeps the previous value and displays the API error when persistence fails', async () => {
    vi.mocked(authFetch)
      .mockResolvedValueOnce(sessionResponse('session-1', true))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'SERVICE_NOT_READY', message: '暂时无法保存联网设置' } },
          503,
        ),
      );

    render(<SessionPage />);
    const toggle = await screen.findByRole('switch', { name: '联网搜索' });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(toggle);

    expect(await screen.findByText('暂时无法保存联网设置')).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle).toHaveProperty('disabled', false);
  });

  it('does not let a stale GET overwrite the newly selected session', async () => {
    const oldGet = deferred<Response>();
    vi.mocked(authFetch)
      .mockReturnValueOnce(oldGet.promise)
      .mockResolvedValueOnce(sessionResponse('session-2', true));

    const view = render(<SessionPage />);
    currentSessionId = 'session-2';
    view.rerender(<SessionPage />);

    const toggle = await screen.findByRole('switch', { name: '联网搜索' });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));

    oldGet.resolve(sessionResponse('session-1', false));
    await Promise.resolve();
    await Promise.resolve();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('aborts an in-flight setting update when leaving the page', async () => {
    const pendingPatch = deferred<Response>();
    vi.mocked(authFetch)
      .mockResolvedValueOnce(sessionResponse('session-1', false))
      .mockReturnValueOnce(pendingPatch.promise);

    const view = render(<SessionPage />);
    const toggle = await screen.findByRole('switch', { name: '联网搜索' });
    await waitFor(() => expect(toggle).toHaveProperty('disabled', false));
    fireEvent.click(toggle);

    const patchOptions = vi.mocked(authFetch).mock.calls[1]?.[1];
    const signal = patchOptions?.signal;
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('shows a load error and keeps the switch disabled after GET 500', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(
      jsonResponse({ error: { code: 'SERVICE_NOT_READY', message: '会话服务暂不可用' } }, 500),
    );

    render(<SessionPage />);

    expect(await screen.findByText('会话服务暂不可用')).toBeTruthy();
    expect(screen.getByRole('switch', { name: '联网搜索' })).toHaveProperty('disabled', true);
  });

  it('shows a load error and keeps the switch disabled after GET throws', async () => {
    vi.mocked(authFetch).mockRejectedValueOnce(new Error('network down'));

    render(<SessionPage />);

    expect(await screen.findByText('加载会话失败')).toBeTruthy();
    expect(screen.getByRole('switch', { name: '联网搜索' })).toHaveProperty('disabled', true);
  });

  it('redirects and keeps the switch disabled after GET 404', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(
      jsonResponse({ error: { code: 'NOT_FOUND', message: '会话不存在' } }, 404),
    );

    render(<SessionPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/chat'));
    expect(screen.getByText('正在加载会话…')).toBeTruthy();
    expect(screen.getByRole('switch', { name: '联网搜索' })).toHaveProperty('disabled', true);
  });
});
