import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/lib/errors';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockInsert = vi.fn();

vi.mock('@/db/client', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mockSelect,
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: mockInsert,
      }),
    }),
  }),
}));

vi.mock('@/modules/auth/password', () => ({
  hashPassword: vi.fn(async (pw: string) => `$2b$12$mocked-hash-for-${pw}`),
  verifyPassword: vi.fn(
    async (pw: string, hash: string) => hash === `$2b$12$mocked-hash-for-${pw}`,
  ),
}));

vi.mock('@/lib/uuid', () => ({
  generateId: () => '00000000-0000-7000-0000-000000000001',
}));

vi.mock('@/lib/datetime', () => ({
  utcNow: () => '2026-07-12T00:00:00.000Z',
}));

import { registerUser, validateCredentials } from '@/modules/auth/service';

// ─── Helper ──────────────────────────────────────────────────────────────────

async function expectAppError(fn: Promise<unknown>, code: string) {
  try {
    await fn;
    throw new Error(`Expected AppError with code ${code}, but no error was thrown`);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('registerUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('创建 pending 用户', async () => {
    mockSelect.mockResolvedValueOnce([]);
    const mockUser = {
      id: '00000000-0000-7000-0000-000000000001',
      username: 'newuser',
      passwordHash: '$2b$12$mocked-hash-for-secure-password',
      role: 'user',
      status: 'pending',
      registrationReason: null,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    };
    mockInsert.mockResolvedValueOnce([mockUser]);

    const user = await registerUser('newuser', 'secure-password');

    expect(user.status).toBe('pending');
    expect(user.role).toBe('user');
    expect(user.username).toBe('newuser');
  });

  it('重复用户名抛 CONFLICT', async () => {
    mockSelect.mockResolvedValueOnce([{ id: 'existing-id', username: 'existing' }]);

    await expectAppError(registerUser('existing', 'secure-password'), 'CONFLICT');
  });
});

describe('validateCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正确凭据返回用户', async () => {
    mockSelect.mockResolvedValueOnce([
      {
        id: 'user-1',
        username: 'activeuser',
        passwordHash: '$2b$12$mocked-hash-for-correct-pw',
        role: 'user',
        status: 'active',
      },
    ]);

    const user = await validateCredentials('activeuser', 'correct-pw');

    expect(user.id).toBe('user-1');
    expect(user.username).toBe('activeuser');
    expect(user.role).toBe('user');
    expect(user.status).toBe('active');
  });

  it('错误密码抛 INVALID_CREDENTIALS', async () => {
    mockSelect.mockResolvedValueOnce([
      {
        id: 'user-1',
        username: 'activeuser',
        passwordHash: '$2b$12$mocked-hash-for-correct-pw',
        role: 'user',
        status: 'active',
      },
    ]);

    await expectAppError(validateCredentials('activeuser', 'wrong-pw'), 'INVALID_CREDENTIALS');
  });

  it('不存在用户抛 INVALID_CREDENTIALS（不泄露用户名）', async () => {
    mockSelect.mockResolvedValueOnce([]);

    await expectAppError(validateCredentials('nonexistent', 'any-password'), 'INVALID_CREDENTIALS');
  });

  it('pending 用户抛 ACCOUNT_PENDING', async () => {
    mockSelect.mockResolvedValueOnce([
      {
        id: 'user-2',
        username: 'pendinguser',
        passwordHash: '$2b$12$mocked-hash-for-correct-pw',
        role: 'user',
        status: 'pending',
      },
    ]);

    await expectAppError(validateCredentials('pendinguser', 'correct-pw'), 'ACCOUNT_PENDING');
  });

  it('disabled 用户抛 ACCOUNT_DISABLED', async () => {
    mockSelect.mockResolvedValueOnce([
      {
        id: 'user-3',
        username: 'disableduser',
        passwordHash: '$2b$12$mocked-hash-for-correct-pw',
        role: 'user',
        status: 'disabled',
      },
    ]);

    await expectAppError(validateCredentials('disableduser', 'correct-pw'), 'ACCOUNT_DISABLED');
  });
});
