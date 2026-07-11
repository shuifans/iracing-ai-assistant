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
  // 1. Global scope
  const globalResult = repository.checkAndIncrement('global', 'minute');
  if (!globalResult.allowed) {
    throw new AppError('RATE_LIMITED', `全局限流：每分钟请求已达上限，${globalResult.resetAt} 后重置`);
  }
  const globalDayResult = repository.checkAndIncrement('global', 'day');
  if (!globalDayResult.allowed) {
    throw new AppError('RATE_LIMITED', `全局限流：每日请求已达上限，${globalDayResult.resetAt} 后重置`);
  }

  // 2. Role scope
  const roleResult = repository.checkAndIncrement(userRole, 'minute');
  if (!roleResult.allowed) {
    throw new AppError('RATE_LIMITED', `角色限流（${userRole}）：每分钟请求已达上限，${roleResult.resetAt} 后重置`);
  }
  const roleDayResult = repository.checkAndIncrement(userRole, 'day');
  if (!roleDayResult.allowed) {
    throw new AppError('RATE_LIMITED', `角色限流（${userRole}）：每日请求已达上限，${roleDayResult.resetAt} 后重置`);
  }

  // 3. User scope
  const userResult = repository.checkAndIncrement(userId, 'minute');
  if (!userResult.allowed) {
    throw new AppError('RATE_LIMITED', `用户限流：每分钟请求已达上限，${userResult.resetAt} 后重置`);
  }
  const userDayResult = repository.checkAndIncrement(userId, 'day');
  if (!userDayResult.allowed) {
    throw new AppError('RATE_LIMITED', `用户限流：每日请求已达上限，${userDayResult.resetAt} 后重置`);
  }
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
