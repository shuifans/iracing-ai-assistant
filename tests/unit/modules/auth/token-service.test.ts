import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/lib/errors';
import { SignJWT } from 'jose';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// DB mock — 链式查询
const insertMock = vi.fn().mockResolvedValue(undefined);
const selectMock = vi.fn().mockResolvedValue([]);
const updateSetMock = vi.fn().mockResolvedValue(undefined);

const dbMock = {
  insert: vi.fn().mockReturnValue({ values: insertMock }),
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: selectMock,
      }),
    }),
  }),
  update: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: updateSetMock,
    }),
  }),
};

vi.mock('@/db/client', () => ({
  getDb: () => dbMock,
}));

vi.mock('@/config/env', () => ({
  env: {
    JWT_ACCESS_SECRET: 'test-jwt-secret-for-unit-tests-32bytes!',
    REFRESH_TOKEN_PEPPER: 'test-refresh-pepper',
    IP_HASH_PEPPER: 'test-ip-pepper',
  },
}));

vi.mock('@/lib/uuid', () => {
  let counter = 0;
  return {
    generateId: () => `00000000-0000-7000-0000-${String(++counter).padStart(12, '0')}`,
  };
});

vi.mock('@/lib/datetime', () => ({
  utcNow: () => '2026-07-12T00:00:00.000Z',
}));

import {
  createAccessToken,
  verifyAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeTokenFamily,
  hashToken,
  hashIp,
} from '@/modules/auth/token-service';

// ─── Helper ──────────────────────────────────────────────────────────────────

const testUser = {
  id: 'user-1',
  username: 'testuser',
  role: 'user' as const,
  status: 'active' as const,
};

async function expectAppError(fn: Promise<unknown>, code: string) {
  try {
    await fn;
    throw new Error(`Expected AppError with code ${code}, but no error was thrown`);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
  }
}

// ─── Access Token Tests ─────────────────────────────────────────────────────

describe('createAccessToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('返回 JWT 字符串（三段式 header.payload.signature）', async () => {
    const token = await createAccessToken(testUser);
    expect(typeof token).toBe('string');
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
  });
});

describe('verifyAccessToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('正确解析 payload 返回 AuthenticatedUser', async () => {
    const token = await createAccessToken(testUser);
    const user = await verifyAccessToken(token);
    expect(user.id).toBe('user-1');
    expect(user.role).toBe('user');
    expect(user.status).toBe('active');
  });

  it('过期 token 抛 UNAUTHENTICATED', async () => {
    // 手动创建已过期的 token
    const secret = new TextEncoder().encode('test-jwt-secret-for-unit-tests-32bytes!');
    const expiredToken = await new SignJWT({
      sub: 'user-1',
      role: 'user',
      status: 'active',
      jti: 'expired-jti',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
      .sign(secret);

    await expectAppError(verifyAccessToken(expiredToken), 'UNAUTHENTICATED');
  });

  it('篡改 token 抛 UNAUTHENTICATED', async () => {
    const token = await createAccessToken(testUser);
    // 篡改 payload 部分
    const parts = token.split('.');
    parts[1] = parts[1] + 'tampered';
    const tamperedToken = parts.join('.');
    await expectAppError(verifyAccessToken(tamperedToken), 'UNAUTHENTICATED');
  });
});

// ─── Refresh Token Tests ─────────────────────────────────────────────────────

describe('createRefreshToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('返回原始 token 且与 hash 不同', async () => {
    const result = await createRefreshToken('user-1');

    expect(result.token).toBeDefined();
    expect(typeof result.token).toBe('string');
    expect(result.token.length).toBe(64); // 32 bytes = 64 hex chars
    expect(result.tokenId).toBeDefined();
    expect(result.familyId).toBeDefined();

    // 验证插入到 DB 的是 hash，不是原始值
    const insertedValues = insertMock.mock.calls[0][0];
    expect(insertedValues.tokenHash).not.toBe(result.token);
    expect(insertedValues.tokenHash).toBe(hashToken(result.token));
  });

  it('提供 familyId 时使用给定值', async () => {
    const result = await createRefreshToken('user-1', 'custom-family');
    expect(result.familyId).toBe('custom-family');
  });
});

describe('hashToken', () => {
  it('输出 64 字符 hex', () => {
    const hash = hashToken('some-random-token-value');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('相同输入产生相同 hash', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('不同输入产生不同 hash', () => {
    expect(hashToken('abc')).not.toBe(hashToken('def'));
  });
});

// ─── Rotate Refresh Token Tests ──────────────────────────────────────────────

describe('rotateRefreshToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('创建新 token 并标记旧 token 为 replaced', async () => {
    const originalToken = 'original-raw-token-' + 'a'.repeat(45); // 64 chars
    const originalHash = hashToken(originalToken);

    // 模拟 DB 查找现有 token（未被替换）
    selectMock.mockResolvedValueOnce([
      {
        id: 'old-token-id',
        userId: 'user-1',
        tokenHash: originalHash,
        familyId: 'family-1',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: '2026-07-12T00:00:00.000Z',
        revokedAt: null,
        replacedBy: null,
        userAgent: 'test-agent',
        ipHash: null,
      },
    ]);

    const result = await rotateRefreshToken(originalToken);

    // 新 token 返回
    expect(result.token).toBeDefined();
    expect(result.familyId).toBe('family-1');
    expect(result.tokenId).toBeDefined();

    // 旧 token 被标记为 replaced
    expect(dbMock.update).toHaveBeenCalled();
    const setCall = dbMock.update().set;
    // update().set({...}).where(...) — 验证 set 被调用时包含 replacedBy
    expect(updateSetMock).toHaveBeenCalled();
  });

  it('重放检测：已被替换的 token 撤销 family 并抛 TOKEN_REUSED', async () => {
    const reusedToken = 'reused-raw-token-' + 'b'.repeat(47); // 64 chars
    const reusedHash = hashToken(reusedToken);

    // 模拟 DB 查找 token（已被替换 → replacedBy 有值）
    selectMock.mockResolvedValueOnce([
      {
        id: 'reused-token-id',
        userId: 'user-1',
        tokenHash: reusedHash,
        familyId: 'family-1',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: '2026-07-12T00:00:00.000Z',
        revokedAt: '2026-07-12T01:00:00.000Z',
        replacedBy: 'newer-token-id', // 已被替换
        userAgent: null,
        ipHash: null,
      },
    ]);

    await expectAppError(rotateRefreshToken(reusedToken), 'TOKEN_REUSED');

    // 验证 revokeTokenFamily 被调用（通过 update）
    expect(dbMock.update).toHaveBeenCalled();
  });
});

// ─── Revoke Token Family Tests ───────────────────────────────────────────────

describe('revokeTokenFamily', () => {
  beforeEach(() => vi.clearAllMocks());

  it('撤销 family 下所有 token', async () => {
    await revokeTokenFamily('family-1');

    expect(dbMock.update).toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalled();
  });
});

// ─── hashIp Tests ────────────────────────────────────────────────────────────

describe('hashIp', () => {
  it('使用 pepper 生成 hash', () => {
    const hash = hashIp('192.168.1.1');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('相同 IP 产生相同 hash', () => {
    expect(hashIp('10.0.0.1')).toBe(hashIp('10.0.0.1'));
  });
});
