import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/modules/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ id: 'user-1', role: 'user', status: 'active' })),
  requireActiveUser: vi.fn(),
  validateOrigin: vi.fn(),
}));
vi.mock('@/modules/chat/service', () => ({
  streamChatMessage: vi.fn(() => (async function* () {})()),
}));

import { streamChatMessage } from '@/modules/chat/service';
import { POST } from '@/app/api/chat/messages/route';

describe('POST /api/chat/messages attachment schema', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects more than four attachment IDs before starting a stream', async () => {
    const request = new NextRequest('http://localhost/api/chat/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'session-1',
        content: 'inspect',
        attachmentIds: ['a', 'b', 'c', 'd', 'e'],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(streamChatMessage).not.toHaveBeenCalled();
  });

  it('sanitizes an exception thrown while streaming', async () => {
    vi.mocked(streamChatMessage).mockReturnValueOnce(
      (async function* () {
        throw new Error('token=sk-secret /Users/private https://internal.example/raw');
      })(),
    );
    const request = new NextRequest('http://localhost/api/chat/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', content: 'inspect' }),
    });

    const text = await (await POST(request)).text();

    expect(text).toContain('服务暂时不可用，请重试');
    expect(text).not.toContain('sk-secret');
    expect(text).not.toContain('/Users/private');
    expect(text).not.toContain('internal.example');
  });

  it('aborts the service signal when the response reader is cancelled', async () => {
    let serviceSignal: AbortSignal | undefined;
    vi.mocked(streamChatMessage).mockImplementationOnce((...args: any[]) => {
      serviceSignal = args[4] as AbortSignal;
      return (async function* () {
        await new Promise(() => undefined);
      })();
    });
    const request = new NextRequest('http://localhost/api/chat/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', content: 'inspect' }),
    });
    const response = await POST(request);
    const reader = response.body!.getReader();
    const pending = reader.read();
    await Promise.resolve();

    await reader.cancel();

    expect(serviceSignal?.aborted).toBe(true);
    void pending.catch(() => undefined);
  });
});
