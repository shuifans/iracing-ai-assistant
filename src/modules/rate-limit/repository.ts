/**
 * Rate limit repository — DB operations for configs and buckets.
 *
 * All functions are synchronous (better-sqlite3 is sync).
 * The checkAndIncrement function wraps query + upsert in a single transaction.
 *
 * @module rate-limit/repository
 */

import { eq, and, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  rateLimitConfigs,
  rateLimitBuckets,
  type RateLimitConfig as DbRateLimitConfig,
} from '@/db/schema/admin';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import type {
  AppliedRateLimitScope,
  RateLimitBatchResult,
  RateLimitResult,
  RateLimitConfig,
} from './types';

// ---------------------------------------------------------------------------
// Config CRUD
// ---------------------------------------------------------------------------

/**
 * Get all rate limit configs.
 */
export function getRateLimitConfigs(): RateLimitConfig[] {
  const db = getDb();
  const rows = db.select().from(rateLimitConfigs).all();
  return rows.map(toRateLimitConfig);
}

/**
 * Get a single rate limit config by ID.
 */
export function getRateLimitConfig(id: string): RateLimitConfig | null {
  const db = getDb();
  const result = db.select().from(rateLimitConfigs).where(eq(rateLimitConfigs.id, id)).limit(1).all();
  return result[0] ? toRateLimitConfig(result[0]) : null;
}

/**
 * Update a rate limit config with partial data.
 */
export function updateRateLimitConfig(
  id: string,
  changes: Partial<RateLimitConfig>,
): void {
  const db = getDb();
  const now = utcNow();
  const updates: Record<string, any> = { updatedAt: now };
  if (changes.perMinuteLimit !== undefined) updates.perMinuteLimit = changes.perMinuteLimit;
  if (changes.perDayLimit !== undefined) updates.perDayLimit = changes.perDayLimit;
  if (changes.maxSessionTurns !== undefined) updates.maxSessionTurns = changes.maxSessionTurns;
  if (changes.enabled !== undefined) updates.enabled = changes.enabled;
  db.update(rateLimitConfigs).set(updates).where(eq(rateLimitConfigs.id, id)).run();
}

// ---------------------------------------------------------------------------
// Core rate-limit checks
// ---------------------------------------------------------------------------

/**
 * Evaluate and increment the global, role, and per-user limits atomically.
 *
 * The transaction deliberately has two phases: all configured buckets are
 * read and evaluated first; only an allowed request enters the write phase.
 * Therefore a rejection at a later scope cannot consume earlier buckets.
 */
export function checkAndIncrementAll(
  userId: string,
  userRole: string,
  now = new Date(),
): RateLimitBatchResult {
  const db = getDb();

  return db.transaction(() => {
    const scopes: Array<{
      scope: AppliedRateLimitScope;
      configKey: string;
      bucketKey: string;
      fallbackConfigKey?: string;
    }> = [
      { scope: 'global', configKey: 'global', bucketKey: 'global' },
      { scope: 'role', configKey: userRole, bucketKey: userRole },
      { scope: 'user', configKey: userId, bucketKey: userId, fallbackConfigKey: '*' },
    ];
    const pending: Array<{
      scope: AppliedRateLimitScope;
      scopeKey: string;
      windowType: 'minute' | 'day';
      windowStart: string;
      resetAt: string;
      currentCount: number;
      bucketId?: string;
    }> = [];

    // Phase 1: evaluate every applicable scope without mutating counters.
    for (const descriptor of scopes) {
      let config = db
        .select()
        .from(rateLimitConfigs)
        .where(
          and(
            eq(rateLimitConfigs.scope, descriptor.scope),
            eq(rateLimitConfigs.scopeKey, descriptor.configKey),
          ),
        )
        .limit(1)
        .all()[0];

      if (!config && descriptor.fallbackConfigKey) {
        config = db
          .select()
          .from(rateLimitConfigs)
          .where(
            and(
              eq(rateLimitConfigs.scope, descriptor.scope),
              eq(rateLimitConfigs.scopeKey, descriptor.fallbackConfigKey),
            ),
          )
          .limit(1)
          .all()[0];
      }
      if (!config?.enabled) continue;

      for (const windowType of ['minute', 'day'] as const) {
        const limit =
          windowType === 'minute' ? config.perMinuteLimit : config.perDayLimit;
        if (limit === null) continue;

        const windowStart = getWindowStart(now, windowType);
        const resetAt = getResetAt(windowStart, windowType);
        const bucket = db
          .select()
          .from(rateLimitBuckets)
          .where(
            and(
              eq(rateLimitBuckets.scopeKey, descriptor.bucketKey),
              eq(rateLimitBuckets.windowType, windowType),
              eq(rateLimitBuckets.windowStart, windowStart),
            ),
          )
          .limit(1)
          .all()[0];
        const currentCount = bucket?.count ?? 0;

        if (currentCount >= limit) {
          return {
            allowed: false,
            scope: descriptor.scope,
            scopeKey: descriptor.bucketKey,
            resetAt,
            limitType: windowType,
          };
        }

        pending.push({
          scope: descriptor.scope,
          scopeKey: descriptor.bucketKey,
          windowType,
          windowStart,
          resetAt,
          currentCount,
          bucketId: bucket?.id,
        });
      }
    }

    // Phase 2: every scope passed, so increment the complete bucket set.
    const nowIso = now.toISOString();
    for (const item of pending) {
      if (item.bucketId) {
        db.update(rateLimitBuckets)
          .set({ count: item.currentCount + 1, updatedAt: nowIso })
          .where(eq(rateLimitBuckets.id, item.bucketId))
          .run();
      } else {
        db.insert(rateLimitBuckets)
          .values({
            id: generateId(),
            scopeKey: item.scopeKey,
            windowType: item.windowType,
            windowStart: item.windowStart,
            count: 1,
            updatedAt: nowIso,
          })
          .run();
      }
    }

    return { allowed: true };
  });
}

/**
 * Check rate limit and increment counter in a single SQLite transaction.
 *
 * 1. Query current window's bucket (scope_key + window_type + window_start)
 * 2. Query corresponding scope config to get limit
 * 3. If count >= limit → return allowed=false
 * 4. Otherwise upsert bucket (count+1) → return allowed=true
 */
export function checkAndIncrement(
  scopeKey: string,
  windowType: 'minute' | 'day',
): RateLimitResult {
  const db = getDb();
  const now = new Date();
  const windowStart = getWindowStart(now, windowType);
  const resetAt = getResetAt(windowStart, windowType);

  return db.transaction(() => {
    // 1. Find the config for this scopeKey
    const configs = db
      .select()
      .from(rateLimitConfigs)
      .where(eq(rateLimitConfigs.scopeKey, scopeKey))
      .limit(1)
      .all();

    const config = configs[0];
    if (!config || !config.enabled) {
      // No config or disabled — allow with generous remaining
      return {
        allowed: true,
        remaining: -1,
        resetAt,
        limitType: windowType,
      };
    }

    const limit =
      windowType === 'minute'
        ? (config.perMinuteLimit ?? Infinity)
        : (config.perDayLimit ?? Infinity);

    // 2. Query current bucket
    const buckets = db
      .select()
      .from(rateLimitBuckets)
      .where(
        and(
          eq(rateLimitBuckets.scopeKey, scopeKey),
          eq(rateLimitBuckets.windowType, windowType),
          eq(rateLimitBuckets.windowStart, windowStart),
        ),
      )
      .limit(1)
      .all();

    const bucket = buckets[0];
    const currentCount = bucket?.count ?? 0;

    // 3. Check if limit reached
    if (currentCount >= limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        limitType: windowType,
      };
    }

    // 4. Upsert bucket (increment count)
    const nowIso = utcNow();
    if (bucket) {
      db.update(rateLimitBuckets)
        .set({ count: currentCount + 1, updatedAt: nowIso })
        .where(eq(rateLimitBuckets.id, bucket.id))
        .run();
    } else {
      db.insert(rateLimitBuckets)
        .values({
          id: generateId(),
          scopeKey,
          windowType,
          windowStart,
          count: 1,
          updatedAt: nowIso,
        })
        .run();
    }

    return {
      allowed: true,
      remaining: limit - currentCount - 1,
      resetAt,
      limitType: windowType,
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRateLimitConfig(row: DbRateLimitConfig): RateLimitConfig {
  return {
    id: row.id,
    scope: row.scope,
    scopeKey: row.scopeKey,
    perMinuteLimit: row.perMinuteLimit ?? 0,
    perDayLimit: row.perDayLimit ?? 0,
    maxSessionTurns: row.maxSessionTurns ?? 0,
    enabled: row.enabled,
  };
}

/**
 * Align timestamp to window start.
 * - minute: truncate seconds/ms → YYYY-MM-DDTHH:MM:00.000Z
 * - day: truncate to midnight UTC → YYYY-MM-DDT00:00:00.000Z
 */
export function getWindowStart(now: Date, windowType: 'minute' | 'day'): string {
  const d = new Date(now);
  if (windowType === 'minute') {
    d.setUTCSeconds(0, 0);
  } else {
    d.setUTCHours(0, 0, 0, 0);
  }
  return d.toISOString();
}

/**
 * Compute reset time (window start + 1 window).
 */
function getResetAt(windowStart: string, windowType: 'minute' | 'day'): string {
  const d = new Date(windowStart);
  if (windowType === 'minute') {
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  } else {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString();
}
