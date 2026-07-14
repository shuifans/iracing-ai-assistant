import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/modules/auth/token-service', () => ({
  verifyAccessToken: vi.fn(),
}));

vi.mock('@/modules/chat/service', () => ({
  streamChatMessage: vi.fn(),
}));

vi.mock('@/modules/chat/repository', () => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
}));

import { verifyAccessToken } from '@/modules/auth/token-service';
import { streamChatMessage } from '@/modules/chat/service';
import { createSession, getSession } from '@/modules/chat/repository';
import { POST } from '@/app/api/chat/diagnostic/route';

const ADMIN_USER = {
  id: 'admin-001',
  username: 'admin',
  role: 'admin',
  status: 'active',
};

const OWNED_SESSION = {
  id: 'session-001',
  userId: ADMIN_USER.id,
  title: 'Diagnostic',
  status: 'active',
  qoderSessionId: null,
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
  lastMessageAt: '2026-07-14T00:00:00.000Z',
};

function makeRequest(body: unknown, origin = 'http://localhost'): NextRequest {
  return new NextRequest('http://localhost/api/chat/diagnostic', {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
      host: 'localhost',
      origin,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/chat/diagnostic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyAccessToken).mockResolvedValue(ADMIN_USER as any);
    vi.mocked(createSession).mockReturnValue(OWNED_SESSION as any);
    vi.mocked(getSession).mockReturnValue(OWNED_SESSION as any);
    vi.mocked(streamChatMessage).mockImplementation(() =>
      (async function* () {
        yield {
          requestId: 'request-001',
          sessionId: OWNED_SESSION.id,
          messageId: 'message-001',
          timestamp: '2026-07-14T00:00:00.000Z',
          seq: 1,
          text: 'ok',
        } as any;
      })(),
    );
  });

  it('forbids an ordinary active user', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      ...ADMIN_USER,
      id: 'user-001',
      role: 'user',
    } as any);

    const response = await POST(makeRequest({ questions: ['test'] }));

    expect(response.status).toBe(403);
    expect(streamChatMessage).not.toHaveBeenCalled();
  });

  it('rejects a request with an invalid Origin', async () => {
    const response = await POST(
      makeRequest({ questions: ['test'] }, 'https://attacker.example'),
    );

    expect(response.status).toBe(403);
    expect(streamChatMessage).not.toHaveBeenCalled();
  });

  it('rejects a disabled administrator', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      ...ADMIN_USER,
      status: 'disabled',
    } as any);

    const response = await POST(makeRequest({ questions: ['test'] }));

    expect(response.status).toBe(403);
    expect(streamChatMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty list', []],
    ['more than ten questions', Array.from({ length: 11 }, (_, i) => `question ${i}`)],
    ['a blank question', ['   ']],
    ['a non-string question', [123]],
    ['an overlong question', ['x'.repeat(8001)]],
    ['a null questions value', null],
  ])('rejects %s', async (_label, questions) => {
    const response = await POST(makeRequest({ questions }));

    expect(response.status).toBe(400);
    expect(streamChatMessage).not.toHaveBeenCalled();
  });

  it('rejects a non-object JSON body', async () => {
    const response = await POST(makeRequest(null));

    expect(response.status).toBe(400);
    expect(streamChatMessage).not.toHaveBeenCalled();
  });

  it('rejects an empty supplied session id instead of creating a new session', async () => {
    const response = await POST(makeRequest({ sessionId: '', questions: ['test'] }));

    expect(response.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
    expect(streamChatMessage).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when a supplied session is not owned by the caller', async () => {
    vi.mocked(getSession).mockReturnValue(null);

    const response = await POST(
      makeRequest({ sessionId: 'other-user-session', questions: ['test'] }),
    );

    expect(response.status).toBe(404);
    expect(getSession).toHaveBeenCalledWith('other-user-session', ADMIN_USER.id);
    expect(streamChatMessage).not.toHaveBeenCalled();
  });

  it('allows an active knowledge administrator with an owned session', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      ...ADMIN_USER,
      role: 'knowledge_admin',
    } as any);

    const response = await POST(
      makeRequest({ sessionId: OWNED_SESSION.id, questions: ['test'] }),
    );

    expect(response.status).toBe(200);
    expect(getSession).toHaveBeenCalledWith(OWNED_SESSION.id, ADMIN_USER.id);
    expect(streamChatMessage).toHaveBeenCalledTimes(1);
  });
});
