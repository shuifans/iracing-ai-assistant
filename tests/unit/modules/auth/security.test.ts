/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AppError } from '@/lib/errors';
import { SignJWT } from 'jose';
import { requireRole, validateOrigin } from '@/modules/auth/middleware';
import { hashToken } from '@/modules/auth/token-service';
import type { AuthenticatedUser } from '@/modules/auth/types';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockInsert = vi.fn();

const dbMock = {
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: mockSelect,
      }),
    }),
  }),
  insert: vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: mockInsert,
    }),
  }),
};

vi.mock('@/db/client', () => ({
  getDb: () => dbMock,
}));

vi.mock('@/modules/auth/password', () => ({
  hashPassword: vi.fn(async (pw: string) => `$2b$12$mocked-hash-for-${pw}`),
  verifyPassword: vi.fn(
    async (pw: string, hash: string) => hash === `$2b$12$mocked-hash-for-${pw}`,
  ),
}));

vi.mock('@/config/env', () => ({
  env: {
    JWT_ACCESS_SECRET: 'test-jwt-secret-for-unit-tests-32bytes!',
    REFRESH_TOKEN_PEPPER: 'test-refresh-pepper',
    IP_HASH_PEPPER: 'test-ip-pepper',
  },
}));

vi.mock('@/lib/uuid', () => ({
  generateId: () => '00000000-0000-7000-0000-000000000001',
}));

vi.mock('@/lib/datetime', () => ({
  utcNow: () => '2026-07-12T00:00:00.000Z',
}));

import { validateCredentials, registerUser } from '@/modules/auth/service';
import { createAccessToken, verifyAccessToken } from '@/modules/auth/token-service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(opts?: { method?: string; headers?: Record<string, string> }): NextRequest {
  const url = 'http://localhost:3000/api/test';
  const init = {
    method: opts?.method ?? 'GET',
    headers: new Headers(opts?.headers ?? {}),
  };
  return new NextRequest(url, init as any);
}

async function expectAppError(fn: Promise<unknown>, code: string) {
  try {
    await fn;
    throw new Error(`Expected AppError with code ${code}, but no error was thrown`);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
  }
}

const userUser: AuthenticatedUser = {
  id: 'u-1',
  username: 'alice',
  role: 'user',
  status: 'active',
};

const knowledgeAdmin: AuthenticatedUser = {
  id: 'u-2',
  username: 'ka',
  role: 'knowledge_admin',
  status: 'active',
};

const adminUser: AuthenticatedUser = {
  id: 'u-3',
  username: 'admin',
  role: 'admin',
  status: 'active',
};

// ─── 1. RBAC 矩阵验证 ───────────────────────────────────────────────────────

describe('Security: RBAC 矩阵验证', () => {
  it('user 不能调用 requireRole("admin")', () => {
    expect(() => requireRole(userUser, 'admin')).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('knowledge_admin 不能调用 requireRole("admin")', () => {
    expect(() => requireRole(knowledgeAdmin, 'admin')).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('admin 可以通过 requireRole("admin")', () => {
    expect(() => requireRole(adminUser, 'admin')).not.toThrow();
  });
});

// ─── 2. Token 安全 ───────────────────────────────────────────────────────────

describe('Security: Token 安全', () => {
  beforeEach(() => vi.clearAllMocks());

  it('Access Token 过期时间 ≤ 30 分钟', async () => {
    const token = await createAccessToken(userUser);
    // 解码 JWT payload（不验证签名，仅读取声明）
    const payloadB64 = token.split('.')[1]!;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));

    const iat = payload.iat as number;
    const exp = payload.exp as number;
    const diffMinutes = (exp - iat) / 60;

    expect(diffMinutes).toBeLessThanOrEqual(30);
    expect(diffMinutes).toBeGreaterThan(0);
  });

  it('Refresh Token hash 不等于原始值', () => {
    const rawToken = 'a'.repeat(64);
    const hash = hashToken(rawToken);
    expect(hash).not.toBe(rawToken);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('篡改的 JWT 被拒绝', async () => {
    const token = await createAccessToken(adminUser);
    const parts = token.split('.');
    // 篡改 payload
    parts[1] = parts[1]! + 'TAMPERED';
    const tampered = parts.join('.');
    await expectAppError(verifyAccessToken(tampered), 'UNAUTHENTICATED');
  });
});

// ─── 3. 用户名不泄露 ─────────────────────────────────────────────────────────

describe('Security: 用户名不泄露', () => {
  beforeEach(() => vi.clearAllMocks());

  it('登录不存在的用户名 → INVALID_CREDENTIALS（不是 NOT_FOUND）', async () => {
    mockSelect.mockResolvedValueOnce([]);
    await expectAppError(validateCredentials('ghost', 'any-pw'), 'INVALID_CREDENTIALS');
  });

  it('登录错误密码 → INVALID_CREDENTIALS（不是 FORBIDDEN）', async () => {
    mockSelect.mockResolvedValueOnce([
      {
        id: 'u-10',
        username: 'realuser',
        passwordHash: '$2b$12$mocked-hash-for-real-pw',
        role: 'user',
        status: 'active',
      },
    ]);
    await expectAppError(validateCredentials('realuser', 'wrong-pw'), 'INVALID_CREDENTIALS');
  });
});

// ─── 4. CSRF 防护 ────────────────────────────────────────────────────────────

describe('Security: CSRF 防护', () => {
  it('Origin 不匹配 Host → FORBIDDEN', () => {
    const req = makeRequest({
      method: 'POST',
      headers: { origin: 'https://evil.com', host: 'localhost:3000' },
    });
    expect(() => validateOrigin(req)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('GET 请求不校验 Origin', () => {
    const req = makeRequest({
      method: 'GET',
      headers: { origin: 'https://evil.com', host: 'localhost:3000' },
    });
    expect(() => validateOrigin(req)).not.toThrow();
  });
});

// ─── 5. 注册安全 ─────────────────────────────────────────────────────────────

describe('Security: 注册安全', () => {
  beforeEach(() => vi.clearAllMocks());

  it('注册后 status 必须是 pending', async () => {
    mockSelect.mockResolvedValueOnce([]);
    mockInsert.mockResolvedValueOnce([
      {
        id: '00000000-0000-7000-0000-000000000001',
        username: 'newbie',
        passwordHash: '$2b$12$mocked-hash-for-pw123',
        role: 'user',
        status: 'pending',
        registrationReason: null,
        createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
      },
    ]);

    const user = await registerUser('newbie', 'pw123');
    expect(user.status).toBe('pending');
    expect(user.role).toBe('user');
  });

  it('pending 用户不能登录（ACCOUNT_PENDING）', async () => {
    mockSelect.mockResolvedValueOnce([
      {
        id: 'u-20',
        username: 'pendinguser',
        passwordHash: '$2b$12$mocked-hash-for-correct-pw',
        role: 'user',
        status: 'pending',
      },
    ]);

    await expectAppError(validateCredentials('pendinguser', 'correct-pw'), 'ACCOUNT_PENDING');
  });
});
