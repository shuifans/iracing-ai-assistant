/**
 * Analytics service — business-logic layer wrapping the analytics repository.
 *
 * Validates input parameters, applies sensible defaults, and delegates
 * to the repository for actual DB aggregation queries.
 *
 * @module analytics/service
 */

import * as repo from './repository';
import type {
  StatsOverview,
  UsageTrend,
  PopularQuestion,
  CostSummary,
  FeedbackStats,
  DateRangeParams,
  UsageTrendParams,
} from './types';

/** Default look-back window when no fromDate is supplied (30 days). */
const DEFAULT_LOOKBACK_DAYS = 30;

/**
 * Compute an ISO date string for N days ago from now.
 *
 * @param days - Number of days to look back.
 * @returns ISO 8601 date string at midnight UTC.
 */
function daysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get high-level overview statistics.
 *
 * If no date range is provided, defaults to the last 30 days.
 *
 * @param params - Optional date-range filter.
 * @returns Aggregated {@link StatsOverview}.
 */
export function getOverview(params?: DateRangeParams): StatsOverview {
  const fromDate = params?.fromDate ?? daysAgo(DEFAULT_LOOKBACK_DAYS);
  const toDate = params?.toDate;
  return repo.getOverview(fromDate, toDate);
}

/**
 * Get usage trend data grouped by the specified time period.
 *
 * If no date range is provided, defaults to the last 30 days.
 *
 * @param params - Period granularity and optional date-range filter.
 * @returns Array of {@link UsageTrend} data-points.
 */
export function getUsageTrend(params: UsageTrendParams): UsageTrend[] {
  const fromDate = params.fromDate ?? daysAgo(DEFAULT_LOOKBACK_DAYS);
  const toDate = params.toDate ?? new Date().toISOString();
  return repo.getUsageTrend(params.period, fromDate, toDate);
}

/**
 * Get the most popular user questions.
 *
 * @param limit - Maximum number of results (default: 10, max: 50).
 * @returns Array of {@link PopularQuestion} ordered by frequency.
 */
export function getPopularQuestions(limit?: number): PopularQuestion[] {
  const safeLimit = Math.min(Math.max(limit ?? 10, 1), 50);
  return repo.getPopularQuestions(safeLimit);
}

/**
 * Get cost breakdown grouped by AI model.
 *
 * If no date range is provided, defaults to the last 30 days.
 *
 * @param params - Optional date-range filter.
 * @returns Array of {@link CostSummary} entries.
 */
export function getCostSummary(params?: DateRangeParams): CostSummary[] {
  const fromDate = params?.fromDate ?? daysAgo(DEFAULT_LOOKBACK_DAYS);
  const toDate = params?.toDate;
  return repo.getCostSummary(fromDate, toDate);
}

/**
 * Get aggregated feedback statistics.
 *
 * If no date range is provided, defaults to the last 30 days.
 *
 * @param params - Optional date-range filter.
 * @returns Aggregated {@link FeedbackStats}.
 */
export function getFeedbackStats(params?: DateRangeParams): FeedbackStats {
  const fromDate = params?.fromDate ?? daysAgo(DEFAULT_LOOKBACK_DAYS);
  const toDate = params?.toDate;
  return repo.getFeedbackStats(fromDate, toDate);
}
