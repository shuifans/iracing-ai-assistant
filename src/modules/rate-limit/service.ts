/**
 * Rate limit service — checks all applicable scopes for a user request.
 *
 * Scope check order (SPEC 16):
 *   1. global scope (scope_key = 'global')
 *   2. role scope   (scope_key = userRole, e.g. 'user', 'admin')
 *   3. user scope   (scope_key = userId)
 *
 * @module rate-limit/service
 */

import { AppError } from '@/lib/errors';
import * as repository from './repository';
import type { RateLimitConfig } from './types';

/**
 * Check rate limits for a given user.
 * Checks global → role → user scopes in order.
 * Throws AppError('RATE_LIMITED') if any scope exceeds its limit.
 */
export function checkRateLimit(userId: string, userRole: string): void {
  const result = repository.checkAndIncrementAll(userId, userRole);
  if (result.allowed) return;

  const scopeLabel =
    result.scope === 'global'
      ? '全局限流'
      : result.scope === 'role'
        ? `角色限流（${userRole}）`
        : '用户限流';
  const windowLabel = result.limitType === 'minute' ? '每分钟' : '每日';
  throw new AppError(
    'RATE_LIMITED',
    `${scopeLabel}：${windowLabel}请求已达上限，${result.resetAt} 后重置`,
  );
}

/**
 * Get all rate limit configurations.
 */
export function getRateLimitConfigs(): RateLimitConfig[] {
  return repository.getRateLimitConfigs();
}

/**
 * Update a rate limit configuration.
 */
export function updateRateLimitConfig(
  id: string,
  changes: Partial<RateLimitConfig>,
): RateLimitConfig {
  repository.updateRateLimitConfig(id, changes);
  const updated = repository.getRateLimitConfig(id);
  if (!updated) {
    throw new AppError('NOT_FOUND', `限流配置 ${id} 不存在`);
  }
  return updated;
}
