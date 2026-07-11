/**
 * Analytics repository — aggregated queries over usageEvents and messageFeedback.
 *
 * All functions are synchronous (better-sqlite3 is sync).
 * Aggregation is performed via Drizzle ORM `sql` template tags.
 *
 * @module analytics/repository
 */

import { sql, and, gte, lte, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { usageEvents } from '@/db/schema/admin';
import { messageFeedback, messages } from '@/db/schema/chat';
import type {
  StatsOverview,
  UsageTrend,
  PopularQuestion,
  CostSummary,
  FeedbackStats,
} from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a date-range condition array for usageEvents.createdAt.
 *
 * @param fromDate - Optional inclusive start date (ISO 8601).
 * @param toDate   - Optional inclusive end date (ISO 8601).
 * @returns Array of Drizzle SQL conditions (may be empty).
 */
function dateRangeConditions(fromDate?: string, toDate?: string) {
  const conditions = [];
  if (fromDate) {
    conditions.push(gte(usageEvents.createdAt, fromDate));
  }
  if (toDate) {
    conditions.push(lte(usageEvents.createdAt, toDate));
  }
  return conditions;
}

/**
 * Build a date-range condition array for messageFeedback.createdAt.
 *
 * @param fromDate - Optional inclusive start date (ISO 8601).
 * @param toDate   - Optional inclusive end date (ISO 8601).
 * @returns Array of Drizzle SQL conditions (may be empty).
 */
function feedbackDateRangeConditions(fromDate?: string, toDate?: string) {
  const conditions = [];
  if (fromDate) {
    conditions.push(gte(messageFeedback.createdAt, fromDate));
  }
  if (toDate) {
    conditions.push(lte(messageFeedback.createdAt, toDate));
  }
  return conditions;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/**
 * Get high-level overview statistics aggregated from usage events.
 *
 * Computes total calls, active users, average duration, knowledge-hit rate,
 * and failure rate within the optional date range.
 *
 * @param fromDate - Optional inclusive start date (ISO 8601).
 * @param toDate   - Optional inclusive end date (ISO 8601).
 * @returns Aggregated {@link StatsOverview} object.
 */
export function getOverview(fromDate?: string, toDate?: string): StatsOverview {
  const db = getDb();
  const conditions = dateRangeConditions(fromDate, toDate);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const result = db
    .select({
      totalCalls: sql<number>`count(*)`.mapWith(Number),
      activeUsers: sql<number>`count(distinct ${usageEvents.userId})`.mapWith(Number),
      avgDurationMs: sql<number>`coalesce(avg(${usageEvents.durationMs}), 0)`.mapWith(Number),
      knowledgeHits: sql<number>`sum(case when ${usageEvents.knowledgeHit} = 'true' then 1 else 0 end)`.mapWith(Number),
      failures: sql<number>`sum(case when ${usageEvents.result} = 'error' then 1 else 0 end)`.mapWith(Number),
    })
    .from(usageEvents)
    .where(whereClause)
    .all();

  const row = result[0];
  const total = row?.totalCalls ?? 0;

  return {
    totalCalls: total,
    activeUsers: row?.activeUsers ?? 0,
    avgDurationMs: Math.round(row?.avgDurationMs ?? 0),
    knowledgeHitRate: total > 0 ? (row?.knowledgeHits ?? 0) / total : 0,
    failureRate: total > 0 ? (row?.failures ?? 0) / total : 0,
  };
}

// ---------------------------------------------------------------------------
// Usage Trend
// ---------------------------------------------------------------------------

/**
 * Map a period identifier to a SQLite strftime format string.
 *
 * @param period - Time bucket granularity ('day', 'week', or 'month').
 * @returns SQLite strftime expression for grouping.
 */
function periodFormat(period: 'day' | 'week' | 'month'): string {
  switch (period) {
    case 'day':
      return '%Y-%m-%d';
    case 'week':
      return '%Y-W%W';
    case 'month':
      return '%Y-%m';
  }
}

/**
 * Get usage trend data grouped by time period.
 *
 * Each bucket contains call count, error count, and distinct active users.
 *
 * @param period   - Time bucket granularity ('day', 'week', or 'month').
 * @param fromDate - Inclusive start date (ISO 8601).
 * @param toDate   - Inclusive end date (ISO 8601).
 * @returns Array of {@link UsageTrend} data-points ordered by date.
 */
export function getUsageTrend(
  period: 'day' | 'week' | 'month',
  fromDate: string,
  toDate: string,
): UsageTrend[] {
  const db = getDb();
  const fmt = periodFormat(period);

  const conditions = dateRangeConditions(fromDate, toDate);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const dateExpr = sql`strftime(${fmt}, ${usageEvents.createdAt})`;

  const rows = db
    .select({
      date: sql<string>`strftime(${fmt}, ${usageEvents.createdAt})`,
      calls: sql<number>`count(*)`.mapWith(Number),
      errors: sql<number>`sum(case when ${usageEvents.result} = 'error' then 1 else 0 end)`.mapWith(Number),
      activeUsers: sql<number>`count(distinct ${usageEvents.userId})`.mapWith(Number),
    })
    .from(usageEvents)
    .where(whereClause)
    .groupBy(dateExpr)
    .orderBy(dateExpr)
    .all();

  return rows;
}

// ---------------------------------------------------------------------------
// Popular Questions
// ---------------------------------------------------------------------------

/**
 * Get the most frequently asked user questions.
 *
 * Joins usageEvents with the messages table to retrieve the original user
 * message content, then groups by content and returns the top-N.
 *
 * @param limit - Maximum number of results to return (default: 10).
 * @returns Array of {@link PopularQuestion} ordered by descending count.
 */
export function getPopularQuestions(limit: number = 10): PopularQuestion[] {
  const db = getDb();

  const rows = db
    .select({
      content: messages.content,
      count: sql<number>`count(*)`.mapWith(Number),
      sessionId: sql<string>`max(${usageEvents.sessionId})`,
    })
    .from(usageEvents)
    .innerJoin(messages, eq(usageEvents.sessionId, messages.sessionId))
    .where(eq(messages.role, 'user'))
    .groupBy(messages.content)
    .orderBy(sql`count(*) desc`)
    .limit(limit)
    .all();

  return rows;
}

// ---------------------------------------------------------------------------
// Cost Summary
// ---------------------------------------------------------------------------

/**
 * Get cost breakdown grouped by AI model.
 *
 * Aggregates token usage and cost across all usage events, partitioned
 * by the `model` field.
 *
 * @param fromDate - Optional inclusive start date (ISO 8601).
 * @param toDate   - Optional inclusive end date (ISO 8601).
 * @returns Array of {@link CostSummary} entries (one per model).
 */
export function getCostSummary(fromDate?: string, toDate?: string): CostSummary[] {
  const db = getDb();
  const conditions = dateRangeConditions(fromDate, toDate);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = db
    .select({
      model: sql<string>`coalesce(${usageEvents.model}, 'unknown')`,
      totalTokenInput: sql<number>`sum(${usageEvents.tokenInput})`.mapWith(Number),
      totalTokenOutput: sql<number>`sum(${usageEvents.tokenOutput})`.mapWith(Number),
      totalCostMicroUsd: sql<number>`sum(${usageEvents.costMicrousd})`.mapWith(Number),
      callCount: sql<number>`count(*)`.mapWith(Number),
    })
    .from(usageEvents)
    .where(whereClause)
    .groupBy(usageEvents.model)
    .all();

  return rows;
}

// ---------------------------------------------------------------------------
// Feedback Stats
// ---------------------------------------------------------------------------

/**
 * Get aggregated feedback statistics (up / down counts and up-rate).
 *
 * Queries the messageFeedback table within the optional date range.
 *
 * @param fromDate - Optional inclusive start date (ISO 8601).
 * @param toDate   - Optional inclusive end date (ISO 8601).
 * @returns Aggregated {@link FeedbackStats} object.
 */
export function getFeedbackStats(fromDate?: string, toDate?: string): FeedbackStats {
  const db = getDb();
  const conditions = feedbackDateRangeConditions(fromDate, toDate);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const result = db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      up: sql<number>`sum(case when ${messageFeedback.rating} = 'up' then 1 else 0 end)`.mapWith(Number),
      down: sql<number>`sum(case when ${messageFeedback.rating} = 'down' then 1 else 0 end)`.mapWith(Number),
    })
    .from(messageFeedback)
    .where(whereClause)
    .all();

  const row = result[0];
  const total = row?.total ?? 0;

  return {
    total,
    up: row?.up ?? 0,
    down: row?.down ?? 0,
    upRate: total > 0 ? (row?.up ?? 0) / total : 0,
  };
}
