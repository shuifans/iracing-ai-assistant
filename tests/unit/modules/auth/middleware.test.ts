import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { AppError } from '@/lib/errors';
import {
  requireAuth,
  requireRole,
  requireActiveUser,
  validateOrigin,
  withErrorHandler,
} from '@/modules/auth/middleware';
import type { AuthenticatedUser } from '@/modules/auth/types';

// Mock token-service
vi.mock('@/modules/auth/token-service', () => ({
  verifyAccessToken: vi.fn(),
}));

import { verifyAccessToken } from '@/modules/auth/token-service';
const mockVerifyAccessToken = vi.mocked(verifyAccessToken);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(opts?: { method?: string; headers?: Record<string, string> }): NextRequest {
  const url = 'http://localhost:3000/api/test';
  const init = {
    method: opts?.method ?? 'GET',
    headers: new Headers(opts?.headers ?? {}),
  };
  return new NextRequest(url, init as any);
}

const adminUser: AuthenticatedUser = {
  id: 'user-1',
  username: 'admin',
  role: 'admin',
  status: 'active',
};

const normalUser: AuthenticatedUser = {
  id: 'user-2',
  username: 'bob',
  role: 'user',
  status: 'active',
};

const knowledgeAdmin: AuthenticatedUser = {
  id: 'user-3',
  username: 'ka',
  role: 'knowledge_admin',
  status: 'active',
};

// ─── requireAuth ─────────────────────────────────────────────────────────────

describe('requireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws UNAUTHENTICATED when no Authorization header', async () => {
    const req = makeRequest();
    await expect(requireAuth(req)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('throws UNAUTHENTICATED for non-Bearer format', async () => {
    const req = makeRequest({ headers: { authorization: 'Basic abc123' } });
    await expect(requireAuth(req)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('returns AuthenticatedUser for valid token', async () => {
    mockVerifyAccessToken.mockResolvedValue(adminUser);
    const req = makeRequest({ headers: { authorization: 'Bearer valid-token' } });

    const user = await requireAuth(req);
    expect(user).toEqual(adminUser);
    expect(mockVerifyAccessToken).toHaveBeenCalledWith('valid-token');
  });

  it('attaches user to request object', async () => {
    mockVerifyAccessToken.mockResolvedValue(adminUser);
    const req = makeRequest({ headers: { authorization: 'Bearer valid-token' } });

    await requireAuth(req);
    expect(req.user).toEqual(adminUser);
  });

  it('propagates UNAUTHENTICATED from verifyAccessToken', async () => {
    mockVerifyAccessToken.mockRejectedValue(
      AppError.fromCode('UNAUTHENTICATED', 'Token 无效或已过期'),
    );
    const req = makeRequest({ headers: { authorization: 'Bearer bad-token' } });

    await expect(requireAuth(req)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});

// ─── requireRole ─────────────────────────────────────────────────────────────

describe('requireRole', () => {
  it('passes when user has the required role', () => {
    expect(() => requireRole(adminUser, 'admin')).not.toThrow();
  });

  it('throws FORBIDDEN when user lacks the required role', () => {
    expect(() => requireRole(normalUser, 'admin')).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('passes when user role matches one of multiple allowed roles', () => {
    expect(() => requireRole(knowledgeAdmin, 'knowledge_admin', 'admin')).not.toThrow();
  });

  it('throws FORBIDDEN when user role not in allowed list', () => {
    expect(() => requireRole(normalUser, 'knowledge_admin', 'admin')).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });
});

// ─── requireActiveUser ───────────────────────────────────────────────────────

describe('requireActiveUser', () => {
  it('passes for active user', () => {
    expect(() => requireActiveUser(adminUser)).not.toThrow();
  });

  it('throws ACCOUNT_DISABLED for non-active user', () => {
    // AuthenticatedUser type restricts status to 'active', but at runtime
    // a disabled user may be cast from DB. Test with a widened type.
    const disabledUser = { ...adminUser, status: 'disabled' as any };
    expect(() => requireActiveUser(disabledUser)).toThrow(
      expect.objectContaining({ code: 'ACCOUNT_DISABLED' }),
    );
  });
});

// ─── validateOrigin ──────────────────────────────────────────────────────────

describe('validateOrigin', () => {
  it('skips validation for GET requests', () => {
    const req = makeRequest({
      method: 'GET',
      headers: { origin: 'https://evil.com', host: 'localhost:3000' },
    });
    expect(() => validateOrigin(req)).not.toThrow();
  });

  it('skips validation for HEAD requests', () => {
    const req = makeRequest({
      method: 'HEAD',
      headers: { origin: 'https://evil.com', host: 'localhost:3000' },
    });
    expect(() => validateOrigin(req)).not.toThrow();
  });

  it('skips validation for OPTIONS requests', () => {
    const req = makeRequest({
      method: 'OPTIONS',
      headers: { origin: 'https://evil.com', host: 'localhost:3000' },
    });
    expect(() => validateOrigin(req)).not.toThrow();
  });

  it('passes when Origin matches Host', () => {
    const req = makeRequest({
      method: 'POST',
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    });
    expect(() => validateOrigin(req)).not.toThrow();
  });

  it('throws FORBIDDEN when Origin does not match Host', () => {
    const req = makeRequest({
      method: 'POST',
      headers: { origin: 'https://evil.com', host: 'localhost:3000' },
    });
    expect(() => validateOrigin(req)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('passes when no Origin header is present', () => {
    const req = makeRequest({
      method: 'POST',
      headers: { host: 'localhost:3000' },
    });
    expect(() => validateOrigin(req)).not.toThrow();
  });

  it('throws FORBIDDEN for invalid Origin URL', () => {
    const req = makeRequest({
      method: 'POST',
      headers: { origin: 'not-a-valid-url', host: 'localhost:3000' },
    });
    expect(() => validateOrigin(req)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});

// ─── withErrorHandler ─────────────────────────────────────────────────────────

describe('withErrorHandler', () => {
  it('converts AppError to JSON response with correct status', async () => {
    const handler = vi.fn().mockRejectedValue(new AppError('FORBIDDEN', '权限不足'));
    const wrapped = withErrorHandler(handler);
    const req = makeRequest();

    const response = await wrapped(req);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toBe('权限不足');
  });

  it('converts non-AppError to 500 response', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('random error'));
    const wrapped = withErrorHandler(handler);
    const req = makeRequest();

    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await wrapped(req);
    const body = await response.json();
    consoleSpy.mockRestore();

    expect(response.status).toBe(500); // hardcoded 500 for unexpected errors
    expect(body.error.code).toBe('SERVICE_NOT_READY');
  });

  it('passes through successful handler response', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ data: 'ok' }, { status: 200 }));
    const wrapped = withErrorHandler(handler);
    const req = makeRequest();

    const response = await wrapped(req);
    expect(response.status).toBe(200);
  });
});
