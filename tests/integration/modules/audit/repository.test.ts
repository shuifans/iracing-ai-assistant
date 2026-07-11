import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq, and, desc, lt, gte, lte } from 'drizzle-orm';
import { auditLogs } from '@/db/schema/admin';
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

describeIf('Audit repository (integration)', () => {
  let db: TestDb;
  let rawDb: any;
  let cleanup: () => void;

  beforeAll(() => {
    const test = createTestDb();
    db = test.db;
    rawDb = test.rawDb;
    cleanup = test.cleanup;

    // Seed users for FK
    rawDb.exec(`
      INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
      VALUES ('u-audit-1', 'audit_admin', 'hash', 'admin', 'active', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
    `);
    rawDb.exec(`
      INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
      VALUES ('u-audit-2', 'audit_user', 'hash', 'user', 'active', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
    `);

    // Seed audit logs (10 entries, spread across 2 days)
    const entries = [
      { id: 'al-01', actorId: 'u-audit-1', action: 'user.approved', resource: 'user', resourceId: 'u-target-1', date: '2026-07-10T08:00:00.000Z' },
      { id: 'al-02', actorId: 'u-audit-1', action: 'user.disabled', resource: 'user', resourceId: 'u-target-2', date: '2026-07-10T09:00:00.000Z' },
      { id: 'al-03', actorId: 'u-audit-2', action: 'knowledge.submitted', resource: 'knowledge_source', resourceId: 'ks-1', date: '2026-07-10T10:00:00.000Z' },
      { id: 'al-04', actorId: 'u-audit-1', action: 'rate_limit.updated', resource: 'rate_limit_config', resourceId: 'rlc-1', date: '2026-07-10T11:00:00.000Z', changes: '{"perMinuteLimit":60}' },
      { id: 'al-05', actorId: 'u-audit-1', action: 'settings.updated', resource: 'system_setting', resourceId: 'ss-1', date: '2026-07-10T12:00:00.000Z' },
      { id: 'al-06', actorId: 'u-audit-2', action: 'knowledge.approved', resource: 'knowledge_item', resourceId: 'ki-1', date: '2026-07-11T08:00:00.000Z' },
      { id: 'al-07', actorId: 'u-audit-1', action: 'user.role_changed', resource: 'user', resourceId: 'u-target-3', date: '2026-07-11T09:00:00.000Z' },
      { id: 'al-08', actorId: 'u-audit-1', action: 'user.deleted', resource: 'user', resourceId: 'u-target-4', date: '2026-07-11T10:00:00.000Z' },
      { id: 'al-09', actorId: 'u-audit-2', action: 'knowledge.rejected', resource: 'knowledge_draft', resourceId: 'kd-1', date: '2026-07-11T11:00:00.000Z' },
      { id: 'al-10', actorId: 'u-audit-1', action: 'session.viewed', resource: 'session', resourceId: 'cs-1', date: '2026-07-11T12:00:00.000Z' },
    ];

    for (const e of entries) {
      const changesJson = e.changes ? `'${e.changes}'` : 'NULL';
      rawDb.exec(`
        INSERT INTO audit_logs (id, actor_id, action, resource, resource_id, request_id, ip_hash, changes_json, created_at)
        VALUES ('${e.id}', '${e.actorId}', '${e.action}', '${e.resource}', '${e.resourceId}', NULL, NULL, ${changesJson}, '${e.date}');
      `);
    }
  });

  afterAll(() => {
    cleanup();
  });

  // ── writeAuditLog ─────────────────────────────────────────────────────────
  describe('writeAuditLog insert', () => {
    it('inserts a new audit log entry', () => {
      const newId = 'al-new-1';
      const now = '2026-07-12T10:00:00.000Z';

      db.insert(auditLogs)
        .values({
          id: newId,
          actorId: 'u-audit-1',
          action: 'user.enabled',
          resource: 'user',
          resourceId: 'u-target-5',
          requestId: null,
          ipHash: null,
          changesJson: null,
          createdAt: now,
        })
        .run();

      const rows = db.select().from(auditLogs).where(eq(auditLogs.id, newId)).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.action).toBe('user.enabled');
      expect(rows[0]!.resource).toBe('user');
      expect(rows[0]!.resourceId).toBe('u-target-5');
      expect(rows[0]!.createdAt).toBe(now);
    });

    it('stores changesJson as serialized JSON', () => {
      const newId = 'al-new-2';
      const now = '2026-07-12T11:00:00.000Z';
      const changes = { enabled: true, reason: 'admin approved' };

      db.insert(auditLogs)
        .values({
          id: newId,
          actorId: 'u-audit-1',
          action: 'user.enabled',
          resource: 'user',
          resourceId: 'u-target-6',
          requestId: null,
          ipHash: null,
          changesJson: JSON.stringify(changes),
          createdAt: now,
        })
        .run();

      const rows = db.select().from(auditLogs).where(eq(auditLogs.id, newId)).all();
      expect(rows[0]!.changesJson).toBe(JSON.stringify(changes));
    });
  });

  // ── listAuditLogs pagination ──────────────────────────────────────────────
  describe('listAuditLogs pagination and filtering', () => {
    it('returns paginated results with correct limit', () => {
      const limit = 3;
      const rows = db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit + 1)
        .all();

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;

      expect(hasMore).toBe(true);
      expect(items).toHaveLength(3);
      // Most recent first
      expect(items[0]!.id).toBe('al-new-2'); // latest inserted
    });

    it('supports cursor-based pagination', () => {
      const limit = 3;

      // First page
      const page1 = db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit + 1)
        .all();

      const hasMore1 = page1.length > limit;
      const items1 = hasMore1 ? page1.slice(0, limit) : page1;
      const cursor = items1[items1.length - 1]!.createdAt;

      expect(hasMore1).toBe(true);
      expect(cursor).toBeTruthy();

      // Second page using cursor (createdAt < cursor)
      const page2 = db
        .select()
        .from(auditLogs)
        .where(lt(auditLogs.createdAt, cursor))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit + 1)
        .all();

      const hasMore2 = page2.length > limit;
      const items2 = hasMore2 ? page2.slice(0, limit) : page2;

      expect(items2).toHaveLength(3);
      // Ensure no overlap with page 1
      for (const item of items2) {
        expect(items1.find((i) => i.id === item.id)).toBeUndefined();
      }
    });

    it('filters by actorId', () => {
      const rows = db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.actorId, 'u-audit-2'))
        .orderBy(desc(auditLogs.createdAt))
        .all();

      // u-audit-2 has: al-03, al-06, al-09 = 3 entries
      expect(rows).toHaveLength(3);
      for (const r of rows) {
        expect(r.actorId).toBe('u-audit-2');
      }
    });

    it('filters by action', () => {
      const rows = db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'user.approved'))
        .all();

      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const r of rows) {
        expect(r.action).toBe('user.approved');
      }
    });

    it('filters by resource', () => {
      const rows = db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.resource, 'user'))
        .orderBy(desc(auditLogs.createdAt))
        .all();

      // resource='user' entries: al-01, al-02, al-07, al-08 + al-new-1, al-new-2
      expect(rows.length).toBeGreaterThanOrEqual(4);
      for (const r of rows) {
        expect(r.resource).toBe('user');
      }
    });

    it('filters by date range', () => {
      const fromDate = '2026-07-11T00:00:00.000Z';
      const toDate = '2026-07-11T23:59:59.999Z';

      const rows = db
        .select()
        .from(auditLogs)
        .where(
          and(
            gte(auditLogs.createdAt, fromDate),
            lte(auditLogs.createdAt, toDate),
          ),
        )
        .orderBy(desc(auditLogs.createdAt))
        .all();

      // Day 2 entries: al-06 to al-10 = 5
      expect(rows).toHaveLength(5);
      for (const r of rows) {
        expect(r.createdAt >= fromDate).toBe(true);
        expect(r.createdAt <= toDate).toBe(true);
      }
    });

    it('returns empty list when no entries match filter', () => {
      const rows = db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.actorId, 'nonexistent-user'))
        .all();

      expect(rows).toHaveLength(0);
    });
  });
});
