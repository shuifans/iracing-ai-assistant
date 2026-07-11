import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the repository module
vi.mock('@/modules/rate-limit/repository', () => ({
  checkAndIncrement: vi.fn(),
  getRateLimitConfigs: vi.fn(),
  getRateLimitConfig: vi.fn(),
  updateRateLimitConfig: vi.fn(),
}));

import * as repository from '@/modules/rate-limit/repository';
import { AppError } from '@/lib/errors';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rate-limit/service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkRateLimit', () => {
    it('passes when all scopes are under limit', async () => {
      vi.mocked(repository.checkAndIncrement).mockReturnValue({
        allowed: true,
        remaining: 5,
        resetAt: '2026-07-12T00:01:00.000Z',
        limitType: 'minute',
      });

      const { checkRateLimit } = await import('@/modules/rate-limit/service');
      expect(() => checkRateLimit('user-001', 'user')).not.toThrow();

      // Should check global(minute+day) + role(minute+day) + user(minute+day) = 6 calls
      expect(repository.checkAndIncrement).toHaveBeenCalledTimes(6);
      expect(repository.checkAndIncrement).toHaveBeenCalledWith('global', 'minute');
      expect(repository.checkAndIncrement).toHaveBeenCalledWith('global', 'day');
      expect(repository.checkAndIncrement).toHaveBeenCalledWith('user', 'minute');
      expect(repository.checkAndIncrement).toHaveBeenCalledWith('user', 'day');
      expect(repository.checkAndIncrement).toHaveBeenCalledWith('user-001', 'minute');
      expect(repository.checkAndIncrement).toHaveBeenCalledWith('user-001', 'day');
    });

    it('throws RATE_LIMITED when global minute limit reached', async () => {
      vi.mocked(repository.checkAndIncrement).mockReturnValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: '2026-07-12T00:01:00.000Z',
        limitType: 'minute',
      });

      const { checkRateLimit } = await import('@/modules/rate-limit/service');
      expect(() => checkRateLimit('user-001', 'user')).toThrow(AppError);
    });

    it('throws RATE_LIMITED when global day limit reached', async () => {
      vi.mocked(repository.checkAndIncrement)
        .mockReturnValueOnce({
          allowed: true,
          remaining: 5,
          resetAt: '2026-07-12T00:01:00.000Z',
          limitType: 'minute',
        })
        .mockReturnValueOnce({
          allowed: false,
          remaining: 0,
          resetAt: '2026-07-13T00:00:00.000Z',
          limitType: 'day',
        });

      const { checkRateLimit } = await import('@/modules/rate-limit/service');
      expect(() => checkRateLimit('user-001', 'user')).toThrow(AppError);
    });

    it('throws RATE_LIMITED when role minute limit reached', async () => {
      vi.mocked(repository.checkAndIncrement)
        .mockReturnValueOnce({ allowed: true, remaining: 5, resetAt: 'x', limitType: 'minute' })
        .mockReturnValueOnce({ allowed: true, remaining: 5, resetAt: 'x', limitType: 'day' })
        .mockReturnValueOnce({
          allowed: false,
          remaining: 0,
          resetAt: '2026-07-12T00:01:00.000Z',
          limitType: 'minute',
        });

      const { checkRateLimit } = await import('@/modules/rate-limit/service');
      expect(() => checkRateLimit('user-001', 'admin')).toThrow(AppError);
    });

    it('throws RATE_LIMITED when user limit reached', async () => {
      vi.mocked(repository.checkAndIncrement)
        .mockReturnValueOnce({ allowed: true, remaining: 5, resetAt: 'x', limitType: 'minute' })
        .mockReturnValueOnce({ allowed: true, remaining: 5, resetAt: 'x', limitType: 'day' })
        .mockReturnValueOnce({ allowed: true, remaining: 5, resetAt: 'x', limitType: 'minute' })
        .mockReturnValueOnce({ allowed: true, remaining: 5, resetAt: 'x', limitType: 'day' })
        .mockReturnValueOnce({
          allowed: false,
          remaining: 0,
          resetAt: '2026-07-12T00:01:00.000Z',
          limitType: 'minute',
        });

      const { checkRateLimit } = await import('@/modules/rate-limit/service');
      expect(() => checkRateLimit('user-001', 'user')).toThrow(AppError);
    });

    it('checks scopes in order: global → role → user', async () => {
      vi.mocked(repository.checkAndIncrement).mockReturnValue({
        allowed: true,
        remaining: 5,
        resetAt: 'x',
        limitType: 'minute',
      });

      const { checkRateLimit } = await import('@/modules/rate-limit/service');
      checkRateLimit('user-001', 'knowledge_admin');

      const calls = vi.mocked(repository.checkAndIncrement).mock.calls;
      expect(calls[0]).toEqual(['global', 'minute']);
      expect(calls[1]).toEqual(['global', 'day']);
      expect(calls[2]).toEqual(['knowledge_admin', 'minute']);
      expect(calls[3]).toEqual(['knowledge_admin', 'day']);
      expect(calls[4]).toEqual(['user-001', 'minute']);
      expect(calls[5]).toEqual(['user-001', 'day']);
    });
  });

  describe('getRateLimitConfigs', () => {
    it('delegates to repository', async () => {
      const mockConfigs = [
        {
          id: 'cfg-1',
          scope: 'global',
          scopeKey: 'global',
          perMinuteLimit: 60,
          perDayLimit: 2000,
          maxSessionTurns: 30,
          enabled: true,
        },
      ];
      vi.mocked(repository.getRateLimitConfigs).mockReturnValue(mockConfigs);

      const { getRateLimitConfigs } = await import('@/modules/rate-limit/service');
      const result = getRateLimitConfigs();

      expect(result).toEqual(mockConfigs);
      expect(repository.getRateLimitConfigs).toHaveBeenCalled();
    });
  });

  describe('updateRateLimitConfig', () => {
    it('updates and returns the config', async () => {
      const updatedConfig = {
        id: 'cfg-1',
        scope: 'global',
        scopeKey: 'global',
        perMinuteLimit: 100,
        perDayLimit: 2000,
        maxSessionTurns: 30,
        enabled: true,
      };
      vi.mocked(repository.getRateLimitConfig).mockReturnValue(updatedConfig);

      const { updateRateLimitConfig } = await import('@/modules/rate-limit/service');
      const result = updateRateLimitConfig('cfg-1', { perMinuteLimit: 100 });

      expect(repository.updateRateLimitConfig).toHaveBeenCalledWith('cfg-1', {
        perMinuteLimit: 100,
      });
      expect(result).toEqual(updatedConfig);
    });

    it('throws NOT_FOUND when config does not exist after update', async () => {
      vi.mocked(repository.getRateLimitConfig).mockReturnValue(null);

      const { updateRateLimitConfig } = await import('@/modules/rate-limit/service');
      expect(() => updateRateLimitConfig('nonexistent', { perMinuteLimit: 100 })).toThrow(AppError);
    });
  });
});
