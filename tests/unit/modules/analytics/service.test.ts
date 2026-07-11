import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the repository module
vi.mock('@/modules/analytics/repository', () => ({
  getOverview: vi.fn(),
  getUsageTrend: vi.fn(),
  getPopularQuestions: vi.fn(),
  getCostSummary: vi.fn(),
  getFeedbackStats: vi.fn(),
}));

import * as repo from '@/modules/analytics/repository';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analytics/service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // getOverview
  // -------------------------------------------------------------------------

  describe('getOverview', () => {
    it('delegates to repository with supplied date range', async () => {
      const mockOverview = {
        totalCalls: 500,
        activeUsers: 25,
        avgDurationMs: 300,
        knowledgeHitRate: 0.7,
        failureRate: 0.02,
      };
      vi.mocked(repo.getOverview).mockReturnValue(mockOverview);

      const { getOverview } = await import('@/modules/analytics/service');
      const result = getOverview({
        fromDate: '2026-07-01T00:00:00.000Z',
        toDate: '2026-07-12T23:59:59.999Z',
      });

      expect(repo.getOverview).toHaveBeenCalledWith(
        '2026-07-01T00:00:00.000Z',
        '2026-07-12T23:59:59.999Z',
      );
      expect(result).toEqual(mockOverview);
    });

    it('applies default fromDate when no params given', async () => {
      vi.mocked(repo.getOverview).mockReturnValue({
        totalCalls: 0,
        activeUsers: 0,
        avgDurationMs: 0,
        knowledgeHitRate: 0,
        failureRate: 0,
      });

      const { getOverview } = await import('@/modules/analytics/service');
      getOverview();

      // Should be called with a fromDate (30 days ago) and undefined toDate
      expect(repo.getOverview).toHaveBeenCalledTimes(1);
      const [fromDate, toDate] = vi.mocked(repo.getOverview).mock.calls[0]!;
      expect(fromDate).toBeDefined();
      expect(typeof fromDate).toBe('string');
      expect(toDate).toBeUndefined();
    });

    it('applies default fromDate when empty params given', async () => {
      vi.mocked(repo.getOverview).mockReturnValue({
        totalCalls: 0,
        activeUsers: 0,
        avgDurationMs: 0,
        knowledgeHitRate: 0,
        failureRate: 0,
      });

      const { getOverview } = await import('@/modules/analytics/service');
      getOverview({});

      expect(repo.getOverview).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // getUsageTrend
  // -------------------------------------------------------------------------

  describe('getUsageTrend', () => {
    it('delegates to repository with period and date range', async () => {
      const mockTrend = [
        { date: '2026-07-10', calls: 50, errors: 2, activeUsers: 8 },
        { date: '2026-07-11', calls: 65, errors: 5, activeUsers: 12 },
      ];
      vi.mocked(repo.getUsageTrend).mockReturnValue(mockTrend);

      const { getUsageTrend } = await import('@/modules/analytics/service');
      const result = getUsageTrend({
        period: 'day',
        fromDate: '2026-07-10T00:00:00.000Z',
        toDate: '2026-07-11T23:59:59.999Z',
      });

      expect(repo.getUsageTrend).toHaveBeenCalledWith(
        'day',
        '2026-07-10T00:00:00.000Z',
        '2026-07-11T23:59:59.999Z',
      );
      expect(result).toEqual(mockTrend);
    });

    it('applies defaults when fromDate/toDate are omitted', async () => {
      vi.mocked(repo.getUsageTrend).mockReturnValue([]);

      const { getUsageTrend } = await import('@/modules/analytics/service');
      getUsageTrend({ period: 'week' });

      expect(repo.getUsageTrend).toHaveBeenCalledTimes(1);
      const [period, fromDate, toDate] = vi.mocked(repo.getUsageTrend).mock.calls[0]!;
      expect(period).toBe('week');
      expect(fromDate).toBeDefined();
      expect(toDate).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // getPopularQuestions
  // -------------------------------------------------------------------------

  describe('getPopularQuestions', () => {
    it('passes the limit through to repository', async () => {
      const mockQuestions = [
        { content: 'How to setup iRacing?', count: 25, sessionId: 'sess-001' },
      ];
      vi.mocked(repo.getPopularQuestions).mockReturnValue(mockQuestions);

      const { getPopularQuestions } = await import('@/modules/analytics/service');
      const result = getPopularQuestions(5);

      expect(repo.getPopularQuestions).toHaveBeenCalledWith(5);
      expect(result).toEqual(mockQuestions);
    });

    it('clamps limit to maximum of 50', async () => {
      vi.mocked(repo.getPopularQuestions).mockReturnValue([]);

      const { getPopularQuestions } = await import('@/modules/analytics/service');
      getPopularQuestions(100);

      expect(repo.getPopularQuestions).toHaveBeenCalledWith(50);
    });

    it('clamps limit to minimum of 1', async () => {
      vi.mocked(repo.getPopularQuestions).mockReturnValue([]);

      const { getPopularQuestions } = await import('@/modules/analytics/service');
      getPopularQuestions(0);

      expect(repo.getPopularQuestions).toHaveBeenCalledWith(1);
    });

    it('uses default limit of 10 when none provided', async () => {
      vi.mocked(repo.getPopularQuestions).mockReturnValue([]);

      const { getPopularQuestions } = await import('@/modules/analytics/service');
      getPopularQuestions();

      expect(repo.getPopularQuestions).toHaveBeenCalledWith(10);
    });
  });

  // -------------------------------------------------------------------------
  // getCostSummary
  // -------------------------------------------------------------------------

  describe('getCostSummary', () => {
    it('delegates to repository with date range', async () => {
      const mockCosts = [
        {
          model: 'claude-sonnet-4-20250514',
          totalTokenInput: 50000,
          totalTokenOutput: 20000,
          totalCostMicroUsd: 150000,
          callCount: 80,
        },
      ];
      vi.mocked(repo.getCostSummary).mockReturnValue(mockCosts);

      const { getCostSummary } = await import('@/modules/analytics/service');
      const result = getCostSummary({
        fromDate: '2026-07-01T00:00:00.000Z',
        toDate: '2026-07-12T23:59:59.999Z',
      });

      expect(repo.getCostSummary).toHaveBeenCalledWith(
        '2026-07-01T00:00:00.000Z',
        '2026-07-12T23:59:59.999Z',
      );
      expect(result).toEqual(mockCosts);
    });

    it('applies default fromDate when no params given', async () => {
      vi.mocked(repo.getCostSummary).mockReturnValue([]);

      const { getCostSummary } = await import('@/modules/analytics/service');
      getCostSummary();

      expect(repo.getCostSummary).toHaveBeenCalledTimes(1);
      const [fromDate] = vi.mocked(repo.getCostSummary).mock.calls[0]!;
      expect(fromDate).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // getFeedbackStats
  // -------------------------------------------------------------------------

  describe('getFeedbackStats', () => {
    it('delegates to repository with date range', async () => {
      const mockFeedback = { total: 200, up: 160, down: 40, upRate: 0.8 };
      vi.mocked(repo.getFeedbackStats).mockReturnValue(mockFeedback);

      const { getFeedbackStats } = await import('@/modules/analytics/service');
      const result = getFeedbackStats({
        fromDate: '2026-07-01T00:00:00.000Z',
        toDate: '2026-07-12T23:59:59.999Z',
      });

      expect(repo.getFeedbackStats).toHaveBeenCalledWith(
        '2026-07-01T00:00:00.000Z',
        '2026-07-12T23:59:59.999Z',
      );
      expect(result).toEqual(mockFeedback);
    });

    it('applies default fromDate when no params given', async () => {
      vi.mocked(repo.getFeedbackStats).mockReturnValue({
        total: 0,
        up: 0,
        down: 0,
        upRate: 0,
      });

      const { getFeedbackStats } = await import('@/modules/analytics/service');
      getFeedbackStats();

      expect(repo.getFeedbackStats).toHaveBeenCalledTimes(1);
      const [fromDate] = vi.mocked(repo.getFeedbackStats).mock.calls[0]!;
      expect(fromDate).toBeDefined();
    });
  });
});
