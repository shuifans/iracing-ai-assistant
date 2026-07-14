/**
 * Rate limit module types.
 *
 * @module rate-limit/types
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: string;
  limitType: 'minute' | 'day';
}

export type AppliedRateLimitScope = 'global' | 'role' | 'user';

export type RateLimitBatchResult =
  | { allowed: true }
  | {
      allowed: false;
      scope: AppliedRateLimitScope;
      scopeKey: string;
      resetAt: string;
      limitType: 'minute' | 'day';
    };

export interface RateLimitConfig {
  id: string;
  scope: string;
  scopeKey: string;
  perMinuteLimit: number;
  perDayLimit: number;
  maxSessionTurns: number;
  enabled: boolean;
}
