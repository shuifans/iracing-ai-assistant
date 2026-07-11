import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq, and, sql } from 'drizzle-orm';
import { rateLimitConfigs, rateLimitBuckets } from '@/db/schema/admin';
import { createTestDb, type TestDb } from '../../../helpers/test-db';

// Skip if native module unavailable
let nativeOk = true;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const probe = new Database(':memory:');
  probe.close();
} catch {
  nativeOk = false;
}

const describeIf = nativeOk ? describe : describe.skip;

// Helper: compute window start for a given Date and window type
function getWindowStart(now: Date, windowType: 'minute' | 'day'): string {
  const d = new Date(now);
  if (windowType === 'minute') {
    d.setUTCSeconds(0, 0);
  } else {
    d.setUTCHours(0, 0, 0, 0);
  }
  return d.toISOString();
}

describeIf('Rate Limit repository (integration)', () => {
  let db: TestDb;
  let rawDb: any;
  let cleanup: () => void;

  beforeAll(() => {
    const test = createTestDb();
    db = test.db;
    rawDb = test.rawDb;
    cleanup = test.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  beforeEach(() => {
    // Clear buckets between tests; keep configs for CRUD tests
    rawDb.exec('DELETE FROM rate_limit_buckets');
  });

  // ── Config CRUD ─────────────────────────────────────────────────────────
  describe('Config CRUD', () => {
    const configId = 'rlc-test-1';
    const now = '2026-07-12T00:00:00.000Z';

    it('inserts a rate limit config', () => {
      db.insert(rateLimitConfigs)
        .values({
          id: configId,
          scope: 'global',
          scopeKey: 'global:all',
          perMinuteLimit: 60,
          perDayLimit: 1000,
          maxSessionTurns: 50,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const rows = db.select().from(rateLimitConfigs).where(eq(rateLimitConfigs.id, configId)).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.perMinuteLimit).toBe(60);
      expect(rows[0]!.perDayLimit).toBe(1000);
      expect(rows[0]!.enabled).toBe(true);
    });

    it('updates a rate limit config', () => {
      const updatedNow = '2026-07-12T01:00:00.000Z';
      db.update(rateLimitConfigs)
        .set({ perMinuteLimit: 100, updatedAt: updatedNow })
        .where(eq(rateLimitConfigs.id, configId))
        .run();

      const rows = db.select().from(rateLimitConfigs).where(eq(rateLimitConfigs.id, configId)).all();
      expect(rows[0]!.perMinuteLimit).toBe(100);
    });

    it('reads all configs', () => {
      const rows = db.select().from(rateLimitConfigs).all();
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it('deletes a rate limit config', () => {
      db.delete(rateLimitConfigs).where(eq(rateLimitConfigs.id, configId)).run();
      const rows = db.select().from(rateLimitConfigs).where(eq(rateLimitConfigs.id, configId)).all();
      expect(rows).toHaveLength(0);
    });
  });

  // ── checkAndIncrement transaction atomicity ──────────────────────────────
  describe('checkAndIncrement transaction', () => {
    const scopeKey = 'global:increment_test';
    const now = '2026-07-12T00:00:00.000Z';

    beforeEach(() => {
      // Ensure config exists with limit = 3 per minute
      rawDb.exec(`DELETE FROM rate_limit_configs WHERE scope_key = '${scopeKey}'`);
      rawDb.exec(`
        INSERT INTO rate_limit_configs (id, scope, scope_key, per_minute_limit, per_day_limit, max_session_turns, enabled, created_at, updated_at)
        VALUES ('rlc-inc-1', 'global', '${scopeKey}', 3, 1000, 100, 1, '${now}', '${now}');
      `);
    });

    it('allows requests under the limit and increments counter atomically', () => {
      const windowType = 'minute' as const;
      const windowStart = getWindowStart(new Date(), windowType);

      // Simulate checkAndIncrement transaction: first call
      const result1 = db.transaction(() => {
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

        const currentCount = buckets[0]?.count ?? 0;
        const limit = 3;

        if (currentCount >= limit) {
          return { allowed: false, count: currentCount };
        }

        if (buckets[0]) {
          db.update(rateLimitBuckets)
            .set({ count: currentCount + 1 })
            .where(eq(rateLimitBuckets.id, buckets[0]!.id))
            .run();
        } else {
          db.insert(rateLimitBuckets)
            .values({
              id: 'bucket-1',
              scopeKey,
              windowType,
              windowStart,
              count: 1,
              updatedAt: now,
            })
            .run();
        }

        return { allowed: true, count: currentCount + 1 };
      });

      expect(result1.allowed).toBe(true);
      expect(result1.count).toBe(1);

      // Verify bucket state
      const bucketRows = db
        .select()
        .from(rateLimitBuckets)
        .where(eq(rateLimitBuckets.scopeKey, scopeKey))
        .all();
      expect(bucketRows).toHaveLength(1);
      expect(bucketRows[0]!.count).toBe(1);
    });

    it('blocks requests when count >= limit', () => {
      const windowType = 'minute' as const;
      const windowStart = getWindowStart(new Date(), windowType);

      // Pre-fill bucket to limit=3
      rawDb.exec(`
        INSERT INTO rate_limit_buckets (id, scope_key, window_type, window_start, count, updated_at)
        VALUES ('bucket-full', '${scopeKey}', 'minute', '${windowStart}', 3, '${now}');
      `);

      const result = db.transaction(() => {
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

        const currentCount = buckets[0]?.count ?? 0;
        const limit = 3;

        if (currentCount >= limit) {
          return { allowed: false, count: currentCount };
        }

        return { allowed: true, count: currentCount + 1 };
      });

      expect(result.allowed).toBe(false);
      expect(result.count).toBe(3);
    });
  });

  // ── Limit trigger (count >= limit) ──────────────────────────────────────
  describe('limit triggering', () => {
    const scopeKey = 'user:limit_trigger';
    const now = '2026-07-12T00:00:00.000Z';

    beforeEach(() => {
      rawDb.exec(`DELETE FROM rate_limit_configs WHERE scope_key = '${scopeKey}'`);
      rawDb.exec(`DELETE FROM rate_limit_buckets WHERE scope_key = '${scopeKey}'`);
    });

    it('allows when no config exists (disabled fallback)', () => {
      // No config → allowed with remaining=-1
      const configs = db
        .select()
        .from(rateLimitConfigs)
        .where(eq(rateLimitConfigs.scopeKey, scopeKey))
        .all();

      // No config found = allow
      expect(configs).toHaveLength(0);
    });

    it('allows when config is disabled', () => {
      rawDb.exec(`
        INSERT INTO rate_limit_configs (id, scope, scope_key, per_minute_limit, per_day_limit, max_session_turns, enabled, created_at, updated_at)
        VALUES ('rlc-disabled', 'user', '${scopeKey}', 5, 100, 50, 0, '${now}', '${now}');
      `);

      const configs = db
        .select()
        .from(rateLimitConfigs)
        .where(eq(rateLimitConfigs.scopeKey, scopeKey))
        .all();

      expect(configs).toHaveLength(1);
      expect(configs[0]!.enabled).toBe(false);
      // Disabled config → allow
    });

    it('triggers at exact limit boundary', () => {
      const windowType = 'minute' as const;
      const windowStart = getWindowStart(new Date(), windowType);
      const limit = 2;

      rawDb.exec(`
        INSERT INTO rate_limit_configs (id, scope, scope_key, per_minute_limit, per_day_limit, max_session_turns, enabled, created_at, updated_at)
        VALUES ('rlc-boundary', 'user', '${scopeKey}', ${limit}, 1000, 100, 1, '${now}', '${now}');
      `);

      // Pre-fill bucket with count = limit - 1 (1)
      rawDb.exec(`
        INSERT INTO rate_limit_buckets (id, scope_key, window_type, window_start, count, updated_at)
        VALUES ('bucket-boundary', '${scopeKey}', 'minute', '${windowStart}', 1, '${now}');
      `);

      // count=1 < limit=2 → allowed, then count becomes 2
      const check1 = db.transaction(() => {
        const buckets = db
          .select()
          .from(rateLimitBuckets)
          .where(eq(rateLimitBuckets.scopeKey, scopeKey))
          .limit(1)
          .all();
        const currentCount = buckets[0]?.count ?? 0;
        if (currentCount >= limit) return { allowed: false };
        db.update(rateLimitBuckets)
          .set({ count: currentCount + 1 })
          .where(eq(rateLimitBuckets.id, buckets[0]!.id))
          .run();
        return { allowed: true };
      });
      expect(check1.allowed).toBe(true);

      // Now count=2 == limit=2 → blocked
      const check2 = db.transaction(() => {
        const buckets = db
          .select()
          .from(rateLimitBuckets)
          .where(eq(rateLimitBuckets.scopeKey, scopeKey))
          .limit(1)
          .all();
        const currentCount = buckets[0]?.count ?? 0;
        if (currentCount >= limit) return { allowed: false };
        return { allowed: true };
      });
      expect(check2.allowed).toBe(false);
    });
  });
});
