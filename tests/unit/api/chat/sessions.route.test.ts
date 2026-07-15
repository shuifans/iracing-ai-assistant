import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/modules/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/modules/auth/middleware')>(
    '@/modules/auth/middleware',
  );
  return {
    ...actual,
    requireAuth: vi.fn(async () => ({ id: 'user-1', role: 'user', status: 'active' })),
    requireActiveUser: vi.fn(),
    validateOrigin: vi.fn(),
  };
});

vi.mock('@/modules/chat/repository', () => ({
  getSession: vi.fn(),
  getMessagesBySession: vi.fn(),
  updateSessionTitle: vi.fn(),
  updateSessionWebSearch: vi.fn(),
  deleteSession: vi.fn(),
}));

import { getSession, updateSessionTitle, updateSessionWebSearch } from '@/modules/chat/repository';
import { PATCH } from '@/app/api/chat/sessions/[id]/route';

const ownedSession = {
  id: 'session-1',
  userId: 'user-1',
  title: 'Setup help',
  status: 'active' as const,
  qoderSessionId: null,
  webSearchEnabled: false,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  lastMessageAt: '2026-07-15T00:00:00.000Z',
};

function request(body: unknown) {
  return new NextRequest('http://localhost/api/chat/sessions/session-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: ownedSession.id }) };

describe('PATCH /api/chat/sessions/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockReturnValue(ownedSession);
    vi.mocked(updateSessionWebSearch).mockReturnValue({
      ...ownedSession,
      webSearchEnabled: true,
    });
  });

  it('updates the owned session web flag', async () => {
    const response = await PATCH(request({ webSearchEnabled: true }), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: ownedSession.id, webSearchEnabled: true },
    });
    expect(updateSessionWebSearch).toHaveBeenCalledWith(ownedSession.id, 'user-1', true);
    expect(updateSessionTitle).not.toHaveBeenCalled();
  });

  it('rejects an initial ownership miss before attempting either update', async () => {
    vi.mocked(getSession).mockReturnValueOnce(null);

    const response = await PATCH(request({ webSearchEnabled: true }), params);

    expect(response.status).toBe(404);
    expect(updateSessionWebSearch).not.toHaveBeenCalled();
    expect(updateSessionTitle).not.toHaveBeenCalled();
  });

  it('returns 404 when the ownership-scoped web update no longer finds the session', async () => {
    vi.mocked(updateSessionWebSearch).mockReturnValueOnce(null);

    const response = await PATCH(request({ webSearchEnabled: true }), params);

    expect(response.status).toBe(404);
    expect(updateSessionWebSearch).toHaveBeenCalledWith(ownedSession.id, 'user-1', true);
  });

  it('still updates a valid title as the only field', async () => {
    const response = await PATCH(request({ title: '  New title  ' }), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: ownedSession.id, title: 'New title' },
    });
    expect(updateSessionTitle).toHaveBeenCalledWith(ownedSession.id, 'New title');
    expect(updateSessionWebSearch).not.toHaveBeenCalled();
  });

  const invalidBodies: Array<[unknown, string]> = [
    [{}, 'empty body'],
    [{ title: 'new', webSearchEnabled: true }, 'both supported fields'],
    [{ webSearchEnabled: 'true' }, 'wrong web flag type'],
    [{ title: '' }, 'empty title'],
    [{ title: `${' '.repeat(200)}a` }, 'title longer than 200 input characters'],
    [{ title: 'new', extra: true }, 'unknown field'],
    [{ unknown: true }, 'only an unknown field'],
  ];

  it.each(invalidBodies)('rejects %s (%s) with VALIDATION_ERROR', async (body) => {
    const response = await PATCH(request(body), params);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(updateSessionTitle).not.toHaveBeenCalled();
    expect(updateSessionWebSearch).not.toHaveBeenCalled();
  });
});
