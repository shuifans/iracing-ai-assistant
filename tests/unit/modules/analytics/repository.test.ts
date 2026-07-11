import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB client before importing repository
vi.mock('@/db/client', () => ({
  getDb: vi.fn(),
}));

// Create mock chainable methods
const mockAll = vi.fn();
const mockLimit = vi.fn();
const mockOrderBy = vi.fn();
const mockGroupBy = vi.fn();
const mockWhere = vi.fn();
const mockInnerJoin = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();

/**
 * Wire up the mock DB so that chained select queries resolve correctly.
 *
 * Supports chains like:
 *   select().from().where().all()
 *   select().from().where().groupBy().orderBy().all()
 *   select().from().innerJoin().where().groupBy().orderBy().limit().all()
 */
function setupMockDb() {
  // select() → { from }
  mockSelect.mockReturnValue({ from: mockFrom });

  // from() → { where, innerJoin, groupBy }
  mockFrom.mockReturnValue({ where: mockWhere, innerJoin: mockInnerJoin, groupBy: mockGroupBy });

  // innerJoin() → { where, groupBy }
  mockInnerJoin.mockReturnValue({ where: mockWhere, groupBy: mockGroupBy });

  // where() → { groupBy, orderBy, limit, all }
  mockWhere.mockReturnValue({
    groupBy: mockGroupBy,
    orderBy: mockOrderBy,
    limit: mockLimit,
    all: mockAll,
  });

  // groupBy() → { orderBy, all }
  mockGroupBy.mockReturnValue({ orderBy: mockOrderBy, all: mockAll });

  // orderBy() → { limit, all }
  mockOrderBy.mockReturnValue({ limit: mockLimit, all: mockAll });

  // limit() → { all }
  mockLimit.mockReturnValue({ all: mockAll });

  // Default: empty result set
  mockAll.mockReturnValue([]);

  vi.mocked(getDb).mockReturnValue({
    select: mockSelect,
  } as any);
}

import { getDb } from '@/db/client';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analytics/repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMockDb();
  });

  // -------------------------------------------------------------------------
  // getOverview
  // -------------------------------------------------------------------------

  describe('getOverview', () => {
    it('returns zeroed stats when no events exist', async () => {
      mockAll.mockReturnValue([
        { totalCalls: 0, activeUsers: 0, avgDurationMs: 0, knowledgeHits: 0, failures: 0 },
      ]);

      const { getOverview } = await import('@/modules/analytics/repository');
      const result = getOverview();

      expect(result.totalCalls).toBe(0);
      expect(result.activeUsers).toBe(0);
      expect(result.avgDurationMs).toBe(0);
      expect(result.knowledgeHitRate).toBe(0);
      expect(result.failureRate).toBe(0);
    });

    it('computes rates correctly from aggregated data', async () => {
      mockAll.mockReturnValue([
        { totalCalls: 100, activeUsers: 10, avgDurationMs: 250.7, knowledgeHits: 60, failures: 5 },
      ]);

      const { getOverview } = await import('@/modules/analytics/repository');
      const result = getOverview('2026-07-01T00:00:00.000Z', '2026-07-12T23:59:59.999Z');

      expect(result.totalCalls).toBe(100);
      expect(result.activeUsers).toBe(10);
      expect(result.avgDurationMs).toBe(251); // rounded
      expect(result.knowledgeHitRate).toBe(0.6);
      expect(result.failureRate).toBe(0.05);
    });

    it('calls select and from on the DB client', async () => {
      mockAll.mockReturnValue([
        { totalCalls: 0, activeUsers: 0, avgDurationMs: 0, knowledgeHits: 0, failures: 0 },
      ]);

      const { getOverview } = await import('@/modules/analytics/repository');
      getOverview();

      expect(mockSelect).toHaveBeenCalled();
      expect(mockFrom).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getUsageTrend
  // -------------------------------------------------------------------------

  describe('getUsageTrend', () => {
    it('returns trend rows grouped by day', async () => {
      const trendRows = [
        { date: '2026-07-10', calls: 50, errors: 2, activeUsers: 8 },
        { date: '2026-07-11', calls: 65, errors: 5, activeUsers: 12 },
        { date: '2026-07-12', calls: 40, errors: 1, activeUsers: 6 },
      ];
      mockAll.mockReturnValue(trendRows);

      const { getUsageTrend } = await import('@/modules/analytics/repository');
      const result = getUsageTrend('day', '2026-07-10T00:00:00.000Z', '2026-07-12T23:59:59.999Z');

      expect(result).toHaveLength(3);
      expect(result[0]!.date).toBe('2026-07-10');
      expect(result[1]!.calls).toBe(65);
      expect(mockSelect).toHaveBeenCalled();
      expect(mockGroupBy).toHaveBeenCalled();
      expect(mockOrderBy).toHaveBeenCalled();
    });

    it('returns empty array when no events match', async () => {
      mockAll.mockReturnValue([]);

      const { getUsageTrend } = await import('@/modules/analytics/repository');
      const result = getUsageTrend('week', '2026-07-01T00:00:00.000Z', '2026-07-12T23:59:59.999Z');

      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getPopularQuestions
  // -------------------------------------------------------------------------

  describe('getPopularQuestions', () => {
    it('returns top-N questions ordered by count', async () => {
      const questions = [
        { content: 'How to setup iRacing?', count: 25, sessionId: 'sess-001' },
        { content: 'Best tire pressure?', count: 18, sessionId: 'sess-005' },
      ];
      mockAll.mockReturnValue(questions);

      const { getPopularQuestions } = await import('@/modules/analytics/repository');
      const result = getPopularQuestions(10);

      expect(result).toHaveLength(2);
      expect(result[0]!.count).toBe(25);
      expect(mockInnerJoin).toHaveBeenCalled();
      expect(mockLimit).toHaveBeenCalled();
    });

    it('uses default limit when none provided', async () => {
      mockAll.mockReturnValue([]);

      const { getPopularQuestions } = await import('@/modules/analytics/repository');
      getPopularQuestions();

      expect(mockLimit).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getCostSummary
  // -------------------------------------------------------------------------

  describe('getCostSummary', () => {
    it('returns cost breakdown per model', async () => {
      const rows = [
        {
          model: 'claude-sonnet-4-20250514',
          totalTokenInput: 50000,
          totalTokenOutput: 20000,
          totalCostMicroUsd: 150000,
          callCount: 80,
        },
        {
          model: 'claude-haiku',
          totalTokenInput: 10000,
          totalTokenOutput: 5000,
          totalCostMicroUsd: 20000,
          callCount: 20,
        },
      ];
      mockAll.mockReturnValue(rows);

      const { getCostSummary } = await import('@/modules/analytics/repository');
      const result = getCostSummary('2026-07-01T00:00:00.000Z', '2026-07-12T23:59:59.999Z');

      expect(result).toHaveLength(2);
      expect(result[0]!.model).toBe('claude-sonnet-4-20250514');
      expect(result[1]!.callCount).toBe(20);
      expect(mockGroupBy).toHaveBeenCalled();
    });

    it('returns empty array when no events exist', async () => {
      mockAll.mockReturnValue([]);

      const { getCostSummary } = await import('@/modules/analytics/repository');
      const result = getCostSummary();

      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getFeedbackStats
  // -------------------------------------------------------------------------

  describe('getFeedbackStats', () => {
    it('returns aggregated feedback counts', async () => {
      mockAll.mockReturnValue([{ total: 200, up: 160, down: 40 }]);

      const { getFeedbackStats } = await import('@/modules/analytics/repository');
      const result = getFeedbackStats('2026-07-01T00:00:00.000Z', '2026-07-12T23:59:59.999Z');

      expect(result.total).toBe(200);
      expect(result.up).toBe(160);
      expect(result.down).toBe(40);
      expect(result.upRate).toBe(0.8);
    });

    it('returns zeroed stats when no feedback exists', async () => {
      mockAll.mockReturnValue([{ total: 0, up: 0, down: 0 }]);

      const { getFeedbackStats } = await import('@/modules/analytics/repository');
      const result = getFeedbackStats();

      expect(result.total).toBe(0);
      expect(result.upRate).toBe(0);
    });
  });
});
