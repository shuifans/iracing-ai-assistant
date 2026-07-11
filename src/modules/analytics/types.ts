/**
 * Analytics module — type definitions for usage statistics and reporting.
 *
 * These interfaces define the shape of aggregated data returned by the
 * analytics repository and service layers.
 *
 * @module analytics/types
 */

/**
 * High-level overview statistics for the admin dashboard.
 *
 * Aggregated across all usage events within an optional date range.
 */
export interface StatsOverview {
  /** Total number of API / chat calls recorded. */
  totalCalls: number;
  /** Number of distinct users who made at least one call. */
  activeUsers: number;
  /** Average response duration in milliseconds. */
  avgDurationMs: number;
  /** Percentage of calls that hit the knowledge base (0–1). */
  knowledgeHitRate: number;
  /** Percentage of calls that resulted in an error (0–1). */
  failureRate: number;
}

/**
 * A single data-point in a time-series usage trend.
 *
 * The `date` field format depends on the requested period
 * (e.g. `2026-07-12` for daily, `2026-W28` for weekly).
 */
export interface UsageTrend {
  /** ISO date string or period label for the bucket. */
  date: string;
  /** Total calls in this period bucket. */
  calls: number;
  /** Number of error results in this period bucket. */
  errors: number;
  /** Distinct active users in this period bucket. */
  activeUsers: number;
}

/**
 * A popular user question derived from the most-referenced user messages.
 */
export interface PopularQuestion {
  /** The original user message content (truncated). */
  content: string;
  /** How many times this question pattern appeared. */
  count: number;
  /** The session ID of the most recent occurrence. */
  sessionId: string;
}

/**
 * Cost breakdown grouped by AI model.
 */
export interface CostSummary {
  /** Model identifier (e.g. "claude-sonnet-4-20250514"). */
  model: string;
  /** Sum of input tokens consumed by this model. */
  totalTokenInput: number;
  /** Sum of output tokens produced by this model. */
  totalTokenOutput: number;
  /** Total cost in micro-USD (1 µUSD = 0.000001 USD). */
  totalCostMicroUsd: number;
  /** Number of calls that used this model. */
  callCount: number;
}

/**
 * Aggregated feedback statistics (thumbs up / down).
 */
export interface FeedbackStats {
  /** Total number of feedback entries. */
  total: number;
  /** Number of "up" (positive) ratings. */
  up: number;
  /** Number of "down" (negative) ratings. */
  down: number;
  /** Percentage of positive ratings (0–1). */
  upRate: number;
}

/**
 * Parameters accepted by repository / service query functions.
 */
export interface DateRangeParams {
  /** Inclusive start date (ISO 8601). */
  fromDate?: string;
  /** Inclusive end date (ISO 8601). */
  toDate?: string;
}

/**
 * Parameters for the usage trend query.
 */
export interface UsageTrendParams extends DateRangeParams {
  /** Time bucket granularity. */
  period: 'day' | 'week' | 'month';
}
