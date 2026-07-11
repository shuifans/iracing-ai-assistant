import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, and, gte, lte, eq } from 'drizzle-orm';
import { usageEvents } from '@/db/schema/admin';
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

describeIf('Analytics repository (integration)', () => {
  let db: TestDb;
  let rawDb: any;
  let cleanup: () => void;

  beforeAll(() => {
    const test = createTestDb();
    db = test.db;
    rawDb = test.rawDb;
    cleanup = test.cleanup;

    // Seed a user for FK
    rawDb.exec(`
      INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
      VALUES ('u-analytics-1', 'analytics_user', 'hash', 'user', 'active', '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z');
    `);
    rawDb.exec(`
      INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
      VALUES ('u-analytics-2', 'analytics_user2', 'hash', 'user', 'active', '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z');
    `);

    // Seed usage_events
    const events = [
      // Day 1: 2026-07-10
      { id: 'ue-1', userId: 'u-analytics-1', model: 'gpt-4', tokenIn: 100, tokenOut: 50, cost: 500, duration: 200, result: 'success', knowledgeHit: 'true', date: '2026-07-10T10:00:00.000Z' },
      { id: 'ue-2', userId: 'u-analytics-1', model: 'gpt-4', tokenIn: 200, tokenOut: 100, cost: 1000, duration: 300, result: 'success', knowledgeHit: 'false', date: '2026-07-10T11:00:00.000Z' },
      { id: 'ue-3', userId: 'u-analytics-2', model: 'claude-3', tokenIn: 150, tokenOut: 75, cost: 750, duration: 400, result: 'error', knowledgeHit: 'true', date: '2026-07-10T12:00:00.000Z' },
      // Day 2: 2026-07-11
      { id: 'ue-4', userId: 'u-analytics-1', model: 'gpt-4', tokenIn: 300, tokenOut: 150, cost: 1500, duration: 500, result: 'success', knowledgeHit: 'true', date: '2026-07-11T09:00:00.000Z' },
      { id: 'ue-5', userId: 'u-analytics-2', model: 'claude-3', tokenIn: 250, tokenOut: 125, cost: 1250, duration: 600, result: 'error', knowledgeHit: 'false', date: '2026-07-11T10:00:00.000Z' },
    ];

    for (const e of events) {
      rawDb.exec(`
        INSERT INTO usage_events (id, user_id, event_type, model, token_input, token_output, cost_microusd, duration_ms, result, knowledge_hit, created_at)
        VALUES ('${e.id}', '${e.userId}', 'chat', '${e.model}', ${e.tokenIn}, ${e.tokenOut}, ${e.cost}, ${e.duration}, '${e.result}', '${e.knowledgeHit}', '${e.date}');
      `);
    }
  });

  afterAll(() => {
    cleanup();
  });

  // ── getOverview aggregation ──────────────────────────────────────────────
  describe('getOverview aggregation', () => {
    it('returns correct totalCalls and activeUsers for all data', () => {
      const result = db
        .select({
          totalCalls: sql<number>`count(*)`.mapWith(Number),
          activeUsers: sql<number>`count(distinct ${usageEvents.userId})`.mapWith(Number),
          avgDurationMs: sql<number>`coalesce(avg(${usageEvents.durationMs}), 0)`.mapWith(Number),
          knowledgeHits: sql<number>`sum(case when ${usageEvents.knowledgeHit} = 'true' then 1 else 0 end)`.mapWith(Number),
          failures: sql<number>`sum(case when ${usageEvents.result} = 'error' then 1 else 0 end)`.mapWith(Number),
        })
        .from(usageEvents)
        .all();

      const row = result[0]!;
      expect(row.totalCalls).toBe(5);
      expect(row.activeUsers).toBe(2);
      // avg duration = (200+300+400+500+600)/5 = 400
      expect(Math.round(row.avgDurationMs)).toBe(400);
      expect(row.knowledgeHits).toBe(3);
      expect(row.failures).toBe(2);
    });

    it('filters by date range correctly', () => {
      const fromDate = '2026-07-11T00:00:00.000Z';
      const toDate = '2026-07-11T23:59:59.999Z';
      const conditions = [
        gte(usageEvents.createdAt, fromDate),
        lte(usageEvents.createdAt, toDate),
      ];

      const result = db
        .select({
          totalCalls: sql<number>`count(*)`.mapWith(Number),
        })
        .from(usageEvents)
        .where(and(...conditions))
        .all();

      expect(result[0]!.totalCalls).toBe(2);
    });

    it('computes knowledgeHitRate and failureRate correctly', () => {
      const result = db
        .select({
          totalCalls: sql<number>`count(*)`.mapWith(Number),
          knowledgeHits: sql<number>`sum(case when ${usageEvents.knowledgeHit} = 'true' then 1 else 0 end)`.mapWith(Number),
          failures: sql<number>`sum(case when ${usageEvents.result} = 'error' then 1 else 0 end)`.mapWith(Number),
        })
        .from(usageEvents)
        .all();

      const row = result[0]!;
      const total = row.totalCalls;
      const knowledgeHitRate = total > 0 ? row.knowledgeHits / total : 0;
      const failureRate = total > 0 ? row.failures / total : 0;

      // 3/5 = 0.6
      expect(knowledgeHitRate).toBeCloseTo(0.6);
      // 2/5 = 0.4
      expect(failureRate).toBeCloseTo(0.4);
    });
  });

  // ── getUsageTrend by day ─────────────────────────────────────────────────
  describe('getUsageTrend by day', () => {
    it('groups events by day correctly', () => {
      const fmt = '%Y-%m-%d';
      const dateExpr = sql`strftime(${fmt}, ${usageEvents.createdAt})`;

      const rows = db
        .select({
          date: sql<string>`strftime(${fmt}, ${usageEvents.createdAt})`,
          calls: sql<number>`count(*)`.mapWith(Number),
          errors: sql<number>`sum(case when ${usageEvents.result} = 'error' then 1 else 0 end)`.mapWith(Number),
          activeUsers: sql<number>`count(distinct ${usageEvents.userId})`.mapWith(Number),
        })
        .from(usageEvents)
        .groupBy(dateExpr)
        .orderBy(dateExpr)
        .all();

      expect(rows).toHaveLength(2);
      // Day 1: 3 calls, 1 error, 2 users
      expect(rows[0]!.date).toBe('2026-07-10');
      expect(rows[0]!.calls).toBe(3);
      expect(rows[0]!.errors).toBe(1);
      expect(rows[0]!.activeUsers).toBe(2);
      // Day 2: 2 calls, 1 error, 2 users
      expect(rows[1]!.date).toBe('2026-07-11');
      expect(rows[1]!.calls).toBe(2);
      expect(rows[1]!.errors).toBe(1);
      expect(rows[1]!.activeUsers).toBe(2);
    });
  });

  // ── getCostSummary by model ──────────────────────────────────────────────
  describe('getCostSummary by model', () => {
    it('groups cost data by model correctly', () => {
      const rows = db
        .select({
          model: sql<string>`coalesce(${usageEvents.model}, 'unknown')`,
          totalTokenInput: sql<number>`sum(${usageEvents.tokenInput})`.mapWith(Number),
          totalTokenOutput: sql<number>`sum(${usageEvents.tokenOutput})`.mapWith(Number),
          totalCostMicroUsd: sql<number>`sum(${usageEvents.costMicrousd})`.mapWith(Number),
          callCount: sql<number>`count(*)`.mapWith(Number),
        })
        .from(usageEvents)
        .groupBy(usageEvents.model)
        .all();

      expect(rows).toHaveLength(2);

      const gpt4 = rows.find((r) => r.model === 'gpt-4')!;
      expect(gpt4).toBeDefined();
      expect(gpt4.callCount).toBe(3);
      expect(gpt4.totalTokenInput).toBe(600); // 100+200+300
      expect(gpt4.totalTokenOutput).toBe(300); // 50+100+150
      expect(gpt4.totalCostMicroUsd).toBe(3000); // 500+1000+1500

      const claude = rows.find((r) => r.model === 'claude-3')!;
      expect(claude).toBeDefined();
      expect(claude.callCount).toBe(2);
      expect(claude.totalTokenInput).toBe(400); // 150+250
      expect(claude.totalTokenOutput).toBe(200); // 75+125
      expect(claude.totalCostMicroUsd).toBe(2000); // 750+1250
    });
  });
});
