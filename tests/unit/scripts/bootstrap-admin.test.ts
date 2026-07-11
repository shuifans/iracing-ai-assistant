import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockSelectLimit = vi.fn();
const mockInsertValues = vi.fn();

vi.mock('@/db/client', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mockSelectLimit,
        }),
      }),
    }),
    insert: () => ({
      values: mockInsertValues,
    }),
  }),
}));

vi.mock('@/modules/auth/password', () => ({
  hashPassword: vi.fn(async (pw: string) => `$2b$12$mocked-hash-for-${pw}`),
}));

vi.mock('@/lib/uuid', () => ({
  generateId: () => '00000000-0000-7000-0000-000000000001',
}));

vi.mock('@/lib/datetime', () => ({
  utcNow: () => '2026-07-12T00:00:00.000Z',
}));

// ─── Import (after mocks) ────────────────────────────────────────────────────

import { bootstrapAdmin } from '../../../scripts/bootstrap-admin';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('bootstrapAdmin', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BOOTSTRAP_ADMIN_USERNAME = 'admin';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'securepassword123';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('缺少 BOOTSTRAP_ADMIN_USERNAME → 返回失败', async () => {
    delete process.env.BOOTSTRAP_ADMIN_USERNAME;

    const result = await bootstrapAdmin();

    expect(result.success).toBe(false);
    expect(result.message).toContain('BOOTSTRAP_ADMIN_USERNAME');
  });

  it('缺少 BOOTSTRAP_ADMIN_PASSWORD → 返回失败', async () => {
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;

    const result = await bootstrapAdmin();

    expect(result.success).toBe(false);
    expect(result.message).toContain('BOOTSTRAP_ADMIN_PASSWORD');
  });

  it('用户名过短 → 返回失败', async () => {
    process.env.BOOTSTRAP_ADMIN_USERNAME = 'ab';

    const result = await bootstrapAdmin();

    expect(result.success).toBe(false);
    expect(result.message).toContain('用户名长度');
  });

  it('密码过短 → 返回失败', async () => {
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'short';

    const result = await bootstrapAdmin();

    expect(result.success).toBe(false);
    expect(result.message).toContain('密码长度');
  });

  it('已存在 admin → 拒绝执行', async () => {
    // 第一次 select: 已存在 admin
    mockSelectLimit.mockResolvedValueOnce([{ id: 'existing-admin' }]);

    const result = await bootstrapAdmin();

    expect(result.success).toBe(false);
    expect(result.message).toContain('已存在管理员');
  });

  it('用户名已存在 → 拒绝执行', async () => {
    // 第一次 select: 无 admin
    mockSelectLimit.mockResolvedValueOnce([]);
    // 第二次 select: 用户名已占用
    mockSelectLimit.mockResolvedValueOnce([{ id: 'existing-user' }]);

    const result = await bootstrapAdmin();

    expect(result.success).toBe(false);
    expect(result.message).toContain('用户名已存在');
  });

  it('正常创建 → 返回 success', async () => {
    // 第一次 select: 无 admin
    mockSelectLimit.mockResolvedValueOnce([]);
    // 第二次 select: 用户名不存在
    mockSelectLimit.mockResolvedValueOnce([]);
    // insert
    mockInsertValues.mockResolvedValueOnce([{ id: '00000000-0000-7000-0000-000000000001' }]);

    const result = await bootstrapAdmin();

    expect(result.success).toBe(true);
    expect(result.message).toContain('admin');
    expect(result.message).toContain('创建成功');
    expect(result.message).toContain('BOOTSTRAP_ADMIN_PASSWORD');

    // 验证 insert 被调用
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '00000000-0000-7000-0000-000000000001',
        username: 'admin',
        passwordHash: '$2b$12$mocked-hash-for-securepassword123',
        role: 'admin',
        status: 'active',
        createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
        approvedAt: '2026-07-12T00:00:00.000Z',
      }),
    );
  });
});
