import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../../../helpers/test-db';

const dbState = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock('@/db/client', () => ({
  getDb: () => dbState.db,
}));

import * as repository from '@/modules/rate-limit/repository';

interface BucketRow {
  scopeKey: string;
  windowType: 'minute' | 'day';
  windowStart: string;
  count: number;
}

const NOW = new Date('2026-07-14T10:30:45.000Z');

describe('Rate limit atomic checks (real SQLite)', () => {
  let db: TestDb;
  let rawDb: ReturnType<typeof createTestDb>['rawDb'];
  let cleanup: () => void;

  beforeAll(() => {
    const testDb = createTestDb();
    db = testDb.db;
    rawDb = testDb.rawDb;
    cleanup = testDb.cleanup;
    dbState.db = db;
  });

  afterAll(() => {
    cleanup();
  });

  beforeEach(() => {
    rawDb.exec('DELETE FROM rate_limit_buckets');
  });

  function check(userId: string, role: string, now = NOW) {
    return repository.checkAndIncrementAll(userId, role, now);
  }

  function replaceConfigs(limits: {
    global: [number, number];
    role: [number, number];
    user: [number, number];
  }): void {
    rawDb.exec('DELETE FROM rate_limit_configs');
    const insert = rawDb.prepare(
      `INSERT INTO rate_limit_configs
       (id, scope, scope_key, per_minute_limit, per_day_limit, max_session_turns, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 30, 1, ?, ?)`,
    );
    const timestamp = NOW.toISOString();
    insert.run('cfg-global', 'global', 'global', ...limits.global, timestamp, timestamp);
    insert.run('cfg-role', 'role', 'user', ...limits.role, timestamp, timestamp);
    insert.run('cfg-user', 'user', 'user-001', ...limits.user, timestamp, timestamp);
  }

  function buckets(): BucketRow[] {
    return rawDb
      .prepare(
        `SELECT scope_key AS scopeKey, window_type AS windowType,
                window_start AS windowStart, count
         FROM rate_limit_buckets
         ORDER BY scope_key, window_type, window_start`,
      )
      .all() as BucketRow[];
  }

  it('applies migrated global, role, and wildcard per-user defaults', () => {
    const result = check('fresh-user-001', 'user');

    expect(result).toEqual({ allowed: true });
    expect(buckets()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scopeKey: 'global', windowType: 'minute', count: 1 }),
        expect.objectContaining({ scopeKey: 'global', windowType: 'day', count: 1 }),
        expect.objectContaining({ scopeKey: 'user', windowType: 'minute', count: 1 }),
        expect.objectContaining({ scopeKey: 'user', windowType: 'day', count: 1 }),
        expect.objectContaining({ scopeKey: 'fresh-user-001', windowType: 'minute', count: 1 }),
        expect.objectContaining({ scopeKey: 'fresh-user-001', windowType: 'day', count: 1 }),
      ]),
    );
    expect(buckets()).toHaveLength(6);
  });

  it('leaves every bucket unchanged when the user-minute scope rejects', () => {
    replaceConfigs({ global: [10, 10], role: [10, 10], user: [1, 10] });
    expect(check('user-001', 'user')).toEqual({ allowed: true });
    const beforeRejectedRequest = buckets();

    const rejected = check('user-001', 'user');

    expect(rejected).toMatchObject({
      allowed: false,
      scope: 'user',
      scopeKey: 'user-001',
      limitType: 'minute',
      resetAt: '2026-07-14T10:31:00.000Z',
    });
    expect(buckets()).toEqual(beforeRejectedRequest);
    expect(buckets()).toHaveLength(6);
    expect(buckets().every((bucket) => bucket.count === 1)).toBe(true);
  });

  it('starts fresh minute buckets after reset while preserving the day window', () => {
    replaceConfigs({ global: [1, 10], role: [1, 10], user: [1, 10] });
    expect(check('user-001', 'user')).toEqual({ allowed: true });
    expect(check('user-001', 'user')).toMatchObject({
      allowed: false,
      scope: 'global',
      limitType: 'minute',
      resetAt: '2026-07-14T10:31:00.000Z',
    });

    expect(check('user-001', 'user', new Date('2026-07-14T10:31:00.000Z'))).toEqual({
      allowed: true,
    });

    const rows = buckets();
    expect(rows.filter((row) => row.windowType === 'minute')).toHaveLength(6);
    expect(rows.filter((row) => row.windowType === 'day')).toHaveLength(3);
    expect(rows.filter((row) => row.windowType === 'day').every((row) => row.count === 2)).toBe(
      true,
    );
  });

  it('starts fresh day buckets at UTC midnight', () => {
    replaceConfigs({ global: [10, 1], role: [10, 1], user: [10, 1] });
    const beforeMidnight = new Date('2026-07-14T23:59:45.000Z');
    expect(check('user-001', 'user', beforeMidnight)).toEqual({ allowed: true });
    expect(check('user-001', 'user', beforeMidnight)).toMatchObject({
      allowed: false,
      scope: 'global',
      limitType: 'day',
      resetAt: '2026-07-15T00:00:00.000Z',
    });

    expect(check('user-001', 'user', new Date('2026-07-15T00:00:00.000Z'))).toEqual({
      allowed: true,
    });

    const rows = buckets();
    expect(rows.filter((row) => row.windowType === 'day')).toHaveLength(6);
    expect(rows.filter((row) => row.windowType === 'day').every((row) => row.count === 1)).toBe(
      true,
    );
  });

  it('reports the first blocked scope in global → role → user precedence', () => {
    replaceConfigs({ global: [10, 1], role: [1, 10], user: [1, 10] });
    const minuteStart = repository.getWindowStart(NOW, 'minute');
    const dayStart = repository.getWindowStart(NOW, 'day');
    const insertBucket = rawDb.prepare(
      `INSERT INTO rate_limit_buckets
       (id, scope_key, window_type, window_start, count, updated_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
    );
    insertBucket.run('global-day-full', 'global', 'day', dayStart, NOW.toISOString());
    insertBucket.run('role-minute-full', 'user', 'minute', minuteStart, NOW.toISOString());
    insertBucket.run('user-minute-full', 'user-001', 'minute', minuteStart, NOW.toISOString());
    const beforeGlobalRejection = buckets();

    expect(check('user-001', 'user')).toMatchObject({
      allowed: false,
      scope: 'global',
      limitType: 'day',
    });
    expect(buckets()).toEqual(beforeGlobalRejection);

    rawDb.prepare("DELETE FROM rate_limit_buckets WHERE scope_key = 'global'").run();
    const beforeRoleRejection = buckets();
    expect(check('user-001', 'user')).toMatchObject({
      allowed: false,
      scope: 'role',
      scopeKey: 'user',
      limitType: 'minute',
    });
    expect(buckets()).toEqual(beforeRoleRejection);
  });
});
