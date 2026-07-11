import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { RATE_LIMIT_SCOPES } from '../../config/constants';
import { users } from './users';

// ─── usage_events ────────────────────────────────────────────────────────────

export const usageEvents = sqliteTable(
  'usage_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    sessionId: text('session_id'),
    jobId: text('job_id'),
    eventType: text('event_type').notNull(),
    model: text('model'),
    tokenInput: integer('token_input').notNull().default(0),
    tokenOutput: integer('token_output').notNull().default(0),
    costMicrousd: integer('cost_microusd').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    result: text('result'),
    knowledgeHit: text('knowledge_hit'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_usage_events_created_type').on(table.createdAt, table.eventType)],
);

export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;

// ─── rate_limit_configs ──────────────────────────────────────────────────────

export const rateLimitConfigs = sqliteTable(
  'rate_limit_configs',
  {
    id: text('id').primaryKey(),
    scope: text('scope', { enum: RATE_LIMIT_SCOPES }).notNull(),
    scopeKey: text('scope_key').notNull(),
    perMinuteLimit: integer('per_minute_limit'),
    perDayLimit: integer('per_day_limit'),
    maxSessionTurns: integer('max_session_turns'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_rate_limit_configs_scope_key').on(table.scope, table.scopeKey)],
);

export type RateLimitConfig = typeof rateLimitConfigs.$inferSelect;
export type NewRateLimitConfig = typeof rateLimitConfigs.$inferInsert;

// ─── rate_limit_buckets ──────────────────────────────────────────────────────

export const rateLimitBuckets = sqliteTable(
  'rate_limit_buckets',
  {
    id: text('id').primaryKey(),
    scopeKey: text('scope_key').notNull(),
    windowType: text('window_type', { enum: ['minute', 'day'] as const }).notNull(),
    windowStart: text('window_start').notNull(),
    count: integer('count').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_rate_limit_buckets_unique').on(
      table.scopeKey,
      table.windowType,
      table.windowStart,
    ),
  ],
);

export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect;
export type NewRateLimitBucket = typeof rateLimitBuckets.$inferInsert;

// ─── audit_logs ──────────────────────────────────────────────────────────────

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    resourceId: text('resource_id').notNull(),
    requestId: text('request_id'),
    ipHash: text('ip_hash'),
    changesJson: text('changes_json'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_audit_logs_resource').on(table.resource, table.resourceId),
    index('idx_audit_logs_created_at').on(table.createdAt),
    index('idx_audit_logs_actor_id').on(table.actorId),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

// ─── system_settings ─────────────────────────────────────────────────────────

export const systemSettings = sqliteTable(
  'system_settings',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    description: text('description'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_system_settings_key').on(table.key)],
);

export type SystemSetting = typeof systemSettings.$inferSelect;
export type NewSystemSetting = typeof systemSettings.$inferInsert;
