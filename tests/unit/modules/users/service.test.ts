import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/lib/errors';
import type { User } from '@/db/schema/users';

// ── hoisted mocks ────────────────────────────────────────────────────────────

const { mockReturning, mockSelect, mockDelete, mockGetDb } = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

  const mockLimit = vi.fn();
  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockSelectWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
  const mockSelectFn = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({ where: mockSelectWhere }),
  });

  const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
  const mockDeleteFn = vi.fn().mockReturnValue({ where: mockDeleteWhere });

  const mockDb = {
    update: mockUpdate,
    select: mockSelectFn,
    delete: mockDeleteFn,
  };

  return {
    mockReturning,
    mockSelect: mockSelectFn,
    mockDelete: mockDeleteFn,
    mockGetDb: vi.fn().mockReturnValue(mockDb),
  };
});

vi.mock('@/db/client', () => ({ getDb: mockGetDb }));
vi.mock('@/lib/datetime', () => ({ utcNow: () => '2026-07-12T00:00:00.000Z' }));
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  and: (...args: unknown[]) => args,
  sql: Object.assign(() => ({}), { raw: () => ({}) }),
  like: (col: unknown, val: unknown) => ({ op: 'like', col, val }),
  lt: (col: unknown, val: unknown) => ({ op: 'lt', col, val }),
  or: (..._args: unknown[]) => ({}),
  isNull: (col: unknown) => ({ op: 'isNull', col }),
}));

// ── imports under test ───────────────────────────────────────────────────────

import {
  approveUser,
  rejectUser,
  disableUser,
  enableUser,
  deleteUser,
  changeUserRole,
  listUsers,
  countActiveAdmins,
  getUserById,
} from '@/modules/users/service';

// ── fixtures ─────────────────────────────────────────────────────────────────

const NOW = '2026-07-12T00:00:00.000Z';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u-1',
    username: 'testuser',
    passwordHash: 'hash',
    role: 'user' as const,
    status: 'active' as const,
    registrationReason: null,
    rejectionReason: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    approvedAt: null,
    lastLoginAt: null,
    approvedBy: null,
    ...overrides,
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('Users Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // re-wire the chain: update().set().where().returning()
    const db = mockGetDb();
    const mockReturning = vi.fn();
    const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    db.update.mockReturnValue({ set: mockSet });

    // store refs for per-test configuration
    (globalThis as any)._ret = mockReturning;
    (globalThis as any)._where = mockWhere;
    (globalThis as any)._set = mockSet;

    // default select chains
    const mockLimit = vi.fn();
    const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockSelectWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({ where: mockSelectWhere }),
    });

    (globalThis as any)._selWhere = mockSelectWhere;
    (globalThis as any)._orderBy = mockOrderBy;
    (globalThis as any)._limit = mockLimit;

    // default delete chain
    const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
    db.delete.mockReturnValue({ where: mockDeleteWhere });
    (globalThis as any)._delWhere = mockDeleteWhere;
  });

  const ret = () => (globalThis as any)._ret;
  const selWhere = () => (globalThis as any)._selWhere;
  const orderBy = () => (globalThis as any)._orderBy;
  const limit = () => (globalThis as any)._limit;

  // ── approveUser ──────────────────────────────────────────────────────────

  describe('approveUser', () => {
    it('should transition pending user to active', async () => {
      const pending = makeUser({ status: 'pending', id: 'u-pending' });
      const approved = makeUser({
        id: 'u-pending',
        status: 'active',
        approvedAt: NOW,
        approvedBy: 'admin-1',
        updatedAt: NOW,
      });
      ret().mockResolvedValue([approved]);

      const result = await approveUser('u-pending', 'admin-1');
      expect(result.status).toBe('active');
      expect(result.approvedBy).toBe('admin-1');
      expect(result.approvedAt).toBe(NOW);
    });

    it('should throw NOT_FOUND if user is not pending', async () => {
      ret().mockResolvedValue([]);
      await expect(approveUser('u-1', 'admin-1')).rejects.toThrow(AppError);
    });
  });

  // ── rejectUser ───────────────────────────────────────────────────────────

  describe('rejectUser', () => {
    it('should transition pending user to rejected with reason', async () => {
      const rejected = makeUser({
        id: 'u-pending',
        status: 'rejected',
        rejectionReason: 'Spam account',
        updatedAt: NOW,
      });
      ret().mockResolvedValue([rejected]);

      const result = await rejectUser('u-pending', 'Spam account');
      expect(result.status).toBe('rejected');
      expect(result.rejectionReason).toBe('Spam account');
    });

    it('should throw NOT_FOUND if user is not pending', async () => {
      ret().mockResolvedValue([]);
      await expect(rejectUser('u-1', 'reason')).rejects.toThrow(AppError);
    });
  });

  // ── disableUser ──────────────────────────────────────────────────────────

  describe('disableUser', () => {
    it('should transition active user to disabled', async () => {
      const activeUser = makeUser({ role: 'user' });
      const disabledUser = makeUser({ role: 'user', status: 'disabled', updatedAt: NOW });

      // 1st select: getUserById → returns user
      // 2nd select: countActiveAdmins → returns [{count: 2}]
      selWhere()
        .mockResolvedValueOnce([activeUser])
        .mockResolvedValueOnce([{ count: 2 }]);
      ret().mockResolvedValue([disabledUser]);

      const result = await disableUser('u-1');
      expect(result.status).toBe('disabled');
    });

    it('should throw FORBIDDEN for last active admin', async () => {
      const admin = makeUser({ role: 'admin', id: 'admin-1' });

      selWhere()
        .mockResolvedValueOnce([admin]) // getUserById
        .mockResolvedValueOnce([{ count: 1 }]); // countActiveAdmins

      try {
        await disableUser('admin-1');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('FORBIDDEN');
      }
    });
  });

  // ── enableUser ───────────────────────────────────────────────────────────

  describe('enableUser', () => {
    it('should transition disabled user to active', async () => {
      const enabled = makeUser({ status: 'active', updatedAt: NOW });
      ret().mockResolvedValue([enabled]);

      const result = await enableUser('u-1');
      expect(result.status).toBe('active');
    });

    it('should throw NOT_FOUND if user is not disabled', async () => {
      ret().mockResolvedValue([]);
      await expect(enableUser('u-1')).rejects.toThrow(AppError);
    });
  });

  // ── deleteUser ───────────────────────────────────────────────────────────

  describe('deleteUser', () => {
    it('should cascade delete user data', async () => {
      const user = makeUser({ role: 'user' });
      selWhere()
        .mockResolvedValueOnce([user]) // getUserById
        .mockResolvedValueOnce([{ count: 0 }]); // countActiveAdmins (not admin, but called)

      const db = mockGetDb();
      await deleteUser('u-1');

      // delete should be called for: refreshTokens, usageEvents, chatSessions, users
      expect(db.delete).toHaveBeenCalledTimes(4);
    });

    it('should throw FORBIDDEN for last active admin', async () => {
      const admin = makeUser({ role: 'admin', id: 'admin-1' });
      selWhere()
        .mockResolvedValueOnce([admin])
        .mockResolvedValueOnce([{ count: 1 }]);

      try {
        await deleteUser('admin-1');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('FORBIDDEN');
      }
    });
  });

  // ── changeUserRole ───────────────────────────────────────────────────────

  describe('changeUserRole', () => {
    it('should protect last admin when demoting admin→user', async () => {
      const admin = makeUser({ role: 'admin', id: 'admin-1' });
      selWhere()
        .mockResolvedValueOnce([admin])
        .mockResolvedValueOnce([{ count: 1 }]);

      try {
        await changeUserRole('admin-1', 'user');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('FORBIDDEN');
      }
    });

    it('should allow promoting user→admin', async () => {
      const user = makeUser({ role: 'user' });
      const updated = makeUser({ role: 'admin', updatedAt: NOW });

      selWhere().mockResolvedValueOnce([user]);
      ret().mockResolvedValue([updated]);

      const result = await changeUserRole('u-1', 'admin');
      expect(result.role).toBe('admin');
    });
  });

  // ── listUsers ────────────────────────────────────────────────────────────

  describe('listUsers', () => {
    it('should return paginated results', async () => {
      const userList = [
        makeUser({ id: 'u-1', username: 'alice' }),
        makeUser({ id: 'u-2', username: 'bob' }),
      ];

      limit().mockResolvedValue(userList);

      const result = await listUsers({ limit: 20 });
      expect(result.users).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
      expect(result.users[0]!.username).toBe('alice');
    });
  });

  // ── countActiveAdmins ────────────────────────────────────────────────────

  describe('countActiveAdmins', () => {
    it('should return count of active admins', async () => {
      selWhere().mockResolvedValue([{ count: 3 }]);
      const count = await countActiveAdmins();
      expect(count).toBe(3);
    });
  });
});
