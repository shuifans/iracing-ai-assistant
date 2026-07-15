import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/modules/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ id: 'user-1', role: 'user', status: 'active' })),
  requireActiveUser: vi.fn(),
  validateOrigin: vi.fn(),
}));
vi.mock('@/modules/chat/service', () => ({
  retryMessage: vi.fn(() => (async function* () {})()),
}));

import { retryMessage } from '@/modules/chat/service';
import { POST } from '@/app/api/chat/messages/[id]/retry/route';

const params = { params: Promise.resolve({ id: 'assistant-1' }) };

describe('POST /api/chat/messages/:id/retry streaming safety', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sanitizes an exception thrown while retrying', async () => {
    vi.mocked(retryMessage).mockReturnValueOnce(
      (async function* () {
        throw new Error('token=sk-secret /Users/private https://internal.example/raw');
      })(),
    );
    const request = new NextRequest('http://localhost/api/chat/messages/assistant-1/retry', {
      method: 'POST',
    });

    const text = await (await POST(request, params)).text();

    expect(text).toContain('服务暂时不可用，请重试');
    expect(text).not.toContain('sk-secret');
    expect(text).not.toContain('/Users/private');
    expect(text).not.toContain('internal.example');
  });

  it('aborts the retry service signal when the response reader is cancelled', async () => {
    let serviceSignal: AbortSignal | undefined;
    vi.mocked(retryMessage).mockImplementationOnce((...args: any[]) => {
      serviceSignal = args[2] as AbortSignal;
      return (async function* () {
        await new Promise(() => undefined);
      })();
    });
    const request = new NextRequest('http://localhost/api/chat/messages/assistant-1/retry', {
      method: 'POST',
    });
    const response = await POST(request, params);
    const reader = response.body!.getReader();
    const pending = reader.read();
    await Promise.resolve();

    await reader.cancel();

    expect(serviceSignal?.aborted).toBe(true);
    void pending.catch(() => undefined);
  });
});
