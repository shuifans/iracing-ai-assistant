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
});
