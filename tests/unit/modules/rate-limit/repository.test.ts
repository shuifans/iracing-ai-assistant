import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB client and drizzle-orm before importing repository
vi.mock('@/db/client', () => ({
  getDb: vi.fn(),
}));

vi.mock('@/lib/uuid', () => ({
  generateId: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).slice(2, 8)),
}));

vi.mock('@/lib/datetime', () => ({
  utcNow: vi.fn(() => '2026-07-12T00:00:00.000Z'),
}));

// Create mock DB with chainable methods
const mockRun = vi.fn();
const mockAll = vi.fn();
const mockLimit = vi.fn();
const mockWhere = vi.fn();
const mockSet = vi.fn();
const mockValues = vi.fn();
const mockFrom = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockTransaction = vi.fn();

function setupMockDb() {
  // select() → from
  mockSelect.mockReturnValue({ from: mockFrom });
  // from() → where OR all (for getRateLimitConfigs which does .from().all())
  mockFrom.mockReturnValue({ where: mockWhere, all: mockAll });
  // where() → limit OR all (some queries use .where().all(), some .where().limit().all())
  mockWhere.mockReturnValue({ limit: mockLimit, all: mockAll, run: mockRun });
  // limit() → all
  mockLimit.mockReturnValue({ all: mockAll });
  mockAll.mockReturnValue([]);

  // Chain: insert().values().run()
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ run: mockRun });

  // Chain: update().set().where().run()
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockWhere, run: mockRun });

  // transaction executes callback synchronously with the same db
  const mockDb = {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    transaction: mockTransaction,
  };
  mockTransaction.mockImplementation((cb: (db: any) => any) => cb(mockDb));

  vi.mocked(getDb).mockReturnValue(mockDb as any);
}

// Import after mocks
import { getDb } from '@/db/client';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rate-limit/repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMockDb();
  });

  describe('getRateLimitConfigs', () => {
    it('returns all configs mapped to RateLimitConfig shape', async () => {
      const dbRows = [
        {
          id: 'cfg-1',
          scope: 'global',
          scopeKey: 'global',
          perMinuteLimit: 60,
          perDayLimit: 2000,
          maxSessionTurns: 30,
          enabled: true,
          createdAt: '2026-07-12T00:00:00.000Z',
          updatedAt: '2026-07-12T00:00:00.000Z',
        },
      ];
      mockAll.mockReturnValue(dbRows);

      const { getRateLimitConfigs } = await import('@/modules/rate-limit/repository');
      const result = getRateLimitConfigs();

      expect(mockSelect).toHaveBeenCalled();
      expect(result).toEqual([
        {
          id: 'cfg-1',
          scope: 'global',
          scopeKey: 'global',
          perMinuteLimit: 60,
          perDayLimit: 2000,
          maxSessionTurns: 30,
          enabled: true,
        },
      ]);
    });

    it('returns empty array when no configs exist', async () => {
      mockAll.mockReturnValue([]);

      const { getRateLimitConfigs } = await import('@/modules/rate-limit/repository');
      const result = getRateLimitConfigs();

      expect(result).toEqual([]);
    });
  });

  describe('getRateLimitConfig', () => {
    it('returns a config by ID', async () => {
      mockAll.mockReturnValue([
        {
          id: 'cfg-1',
          scope: 'user',
          scopeKey: 'user-001',
          perMinuteLimit: 10,
          perDayLimit: 100,
          maxSessionTurns: 30,
          enabled: true,
          createdAt: '2026-07-12T00:00:00.000Z',
          updatedAt: '2026-07-12T00:00:00.000Z',
        },
      ]);

      const { getRateLimitConfig } = await import('@/modules/rate-limit/repository');
      const result = getRateLimitConfig('cfg-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('cfg-1');
      expect(result!.perMinuteLimit).toBe(10);
    });

    it('returns null when config not found', async () => {
      mockAll.mockReturnValue([]);

      const { getRateLimitConfig } = await import('@/modules/rate-limit/repository');
      const result = getRateLimitConfig('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('updateRateLimitConfig', () => {
    it('updates only the provided fields', async () => {
      const { updateRateLimitConfig } = await import('@/modules/rate-limit/repository');
      updateRateLimitConfig('cfg-1', { perMinuteLimit: 20, enabled: false });

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          perMinuteLimit: 20,
          enabled: false,
          updatedAt: '2026-07-12T00:00:00.000Z',
        }),
      );
    });
  });

  describe('checkAndIncrement', () => {
    it('returns allowed=true and increments when under limit', async () => {
      const { checkAndIncrement } = await import('@/modules/rate-limit/repository');

      // First select (inside txn): config query → returns config with limit 10
      // Second select (inside txn): bucket query → returns no bucket (count = 0)
      let callCount = 0;
      mockAll.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Config row
          return [
            {
              id: 'cfg-1',
              scope: 'user',
              scopeKey: 'user-001',
              perMinuteLimit: 10,
              perDayLimit: 100,
              maxSessionTurns: 30,
              enabled: true,
              createdAt: '2026-07-12T00:00:00.000Z',
              updatedAt: '2026-07-12T00:00:00.000Z',
            },
          ];
        }
        // Bucket row — empty = no existing bucket
        return [];
      });

      const result = checkAndIncrement('user-001', 'minute');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9); // 10 - 0 - 1
      expect(result.limitType).toBe('minute');
      expect(mockInsert).toHaveBeenCalled(); // New bucket inserted
    });

    it('returns allowed=false when limit reached', async () => {
      const { checkAndIncrement } = await import('@/modules/rate-limit/repository');

      let callCount = 0;
      mockAll.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return [
            {
              id: 'cfg-1',
              scope: 'user',
              scopeKey: 'user-001',
              perMinuteLimit: 10,
              perDayLimit: 100,
              maxSessionTurns: 30,
              enabled: true,
              createdAt: '2026-07-12T00:00:00.000Z',
              updatedAt: '2026-07-12T00:00:00.000Z',
            },
          ];
        }
        // Bucket at limit
        return [
          {
            id: 'bucket-1',
            scopeKey: 'user-001',
            windowType: 'minute',
            windowStart: '2026-07-12T00:00:00.000Z',
            count: 10,
            updatedAt: '2026-07-12T00:00:00.000Z',
          },
        ];
      });

      const result = checkAndIncrement('user-001', 'minute');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(mockInsert).not.toHaveBeenCalled(); // No insert when blocked
    });

    it('increments existing bucket count', async () => {
      const { checkAndIncrement } = await import('@/modules/rate-limit/repository');

      let callCount = 0;
      mockAll.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return [
            {
              id: 'cfg-1',
              scope: 'user',
              scopeKey: 'user-001',
              perMinuteLimit: 10,
              perDayLimit: 100,
              maxSessionTurns: 30,
              enabled: true,
              createdAt: '2026-07-12T00:00:00.000Z',
              updatedAt: '2026-07-12T00:00:00.000Z',
            },
          ];
        }
        return [
          {
            id: 'bucket-1',
            scopeKey: 'user-001',
            windowType: 'minute',
            windowStart: '2026-07-12T00:00:00.000Z',
            count: 5,
            updatedAt: '2026-07-12T00:00:00.000Z',
          },
        ];
      });

      const result = checkAndIncrement('user-001', 'minute');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // 10 - 5 - 1
      expect(mockUpdate).toHaveBeenCalled(); // Existing bucket updated
    });

    it('allows request when config is disabled', async () => {
      const { checkAndIncrement } = await import('@/modules/rate-limit/repository');

      mockAll.mockReturnValue([
        {
          id: 'cfg-1',
          scope: 'user',
          scopeKey: 'user-001',
          perMinuteLimit: 10,
          perDayLimit: 100,
          maxSessionTurns: 30,
          enabled: false,
          createdAt: '2026-07-12T00:00:00.000Z',
          updatedAt: '2026-07-12T00:00:00.000Z',
        },
      ]);

      const result = checkAndIncrement('user-001', 'minute');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(-1); // No limit enforced
    });

    it('allows request when no config exists', async () => {
      const { checkAndIncrement } = await import('@/modules/rate-limit/repository');
      mockAll.mockReturnValue([]);

      const result = checkAndIncrement('unknown-scope', 'minute');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(-1);
    });

    it('uses day limit for day window type', async () => {
      const { checkAndIncrement } = await import('@/modules/rate-limit/repository');

      let callCount = 0;
      mockAll.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return [
            {
              id: 'cfg-1',
              scope: 'user',
              scopeKey: 'user-001',
              perMinuteLimit: 10,
              perDayLimit: 100,
              maxSessionTurns: 30,
              enabled: true,
              createdAt: '2026-07-12T00:00:00.000Z',
              updatedAt: '2026-07-12T00:00:00.000Z',
            },
          ];
        }
        return [];
      });

      const result = checkAndIncrement('user-001', 'day');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99); // 100 - 0 - 1
      expect(result.limitType).toBe('day');
    });

    it('runs inside a transaction', async () => {
      const { checkAndIncrement } = await import('@/modules/rate-limit/repository');
      mockAll.mockReturnValue([]);

      checkAndIncrement('user-001', 'minute');

      expect(mockTransaction).toHaveBeenCalled();
    });
  });

  describe('getWindowStart', () => {
    it('truncates seconds for minute window', async () => {
      const { getWindowStart } = await import('@/modules/rate-limit/repository');
      const result = getWindowStart(new Date('2026-07-12T10:30:45.123Z'), 'minute');
      expect(result).toBe('2026-07-12T10:30:00.000Z');
    });

    it('truncates to midnight UTC for day window', async () => {
      const { getWindowStart } = await import('@/modules/rate-limit/repository');
      const result = getWindowStart(new Date('2026-07-12T10:30:45.123Z'), 'day');
      expect(result).toBe('2026-07-12T00:00:00.000Z');
    });
  });
});
