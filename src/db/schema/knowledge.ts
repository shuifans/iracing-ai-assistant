import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import {
  KNOWLEDGE_SOURCE_STATUSES,
  JOB_STATUSES,
  DRAFT_STATUSES,
  KNOWLEDGE_ITEM_STATUSES,
  WIKI_SYNC_STATUSES,
} from '../../config/constants';
import { users } from './users';

// ─── knowledge_sources ───────────────────────────────────────────────────────

export const knowledgeSources = sqliteTable(
  'knowledge_sources',
  {
    id: text('id').primaryKey(),
    inputType: text('input_type', { enum: ['file', 'url'] as const }).notNull(),
    originalName: text('original_name'),
    mimeType: text('mime_type'),
    relativePath: text('relative_path'),
    sourceUrl: text('source_url'),
    sha256: text('sha256').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    status: text('status', { enum: KNOWLEDGE_SOURCE_STATUSES }).notNull(),
    submittedBy: text('submitted_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_knowledge_sources_sha256').on(table.sha256),
    index('idx_knowledge_sources_status').on(table.status),
    index('idx_knowledge_sources_submitted_by').on(table.submittedBy),
  ],
);

export type KnowledgeSource = typeof knowledgeSources.$inferSelect;
export type NewKnowledgeSource = typeof knowledgeSources.$inferInsert;

// ─── knowledge_jobs ──────────────────────────────────────────────────────────

export const knowledgeJobs = sqliteTable(
  'knowledge_jobs',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => knowledgeSources.id),
    status: text('status', { enum: JOB_STATUSES }).notNull(),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    availableAt: text('available_at').notNull(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: text('lease_expires_at'),
    heartbeatAt: text('heartbeat_at'),
    progress: integer('progress').notNull().default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_knowledge_jobs_status_available').on(table.status, table.availableAt),
    index('idx_knowledge_jobs_source_id').on(table.sourceId),
  ],
);

export type KnowledgeJob = typeof knowledgeJobs.$inferSelect;
export type NewKnowledgeJob = typeof knowledgeJobs.$inferInsert;

// ─── knowledge_drafts ────────────────────────────────────────────────────────

export const knowledgeDrafts = sqliteTable(
  'knowledge_drafts',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => knowledgeJobs.id),
    suggestedPath: text('suggested_path').notNull(),
    title: text('title').notNull(),
    frontMatterJson: text('front_matter_json').notNull(),
    draftRelativePath: text('draft_relative_path').notNull(),
    contentSha256: text('content_sha256').notNull(),
    status: text('status', { enum: DRAFT_STATUSES }).notNull(),
    reviewNotes: text('review_notes'),
    reviewedBy: text('reviewed_by').references(() => users.id),
    reviewedAt: text('reviewed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_knowledge_drafts_job_id').on(table.jobId)],
);

export type KnowledgeDraft = typeof knowledgeDrafts.$inferSelect;
export type NewKnowledgeDraft = typeof knowledgeDrafts.$inferInsert;

// ─── knowledge_items ─────────────────────────────────────────────────────────

export const knowledgeItems = sqliteTable(
  'knowledge_items',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => knowledgeSources.id),
    draftId: text('draft_id')
      .notNull()
      .references(() => knowledgeDrafts.id),
    title: text('title').notNull(),
    category: text('category', {
      enum: ['track-technique', 'car-setup', 'basics'] as const,
    }).notNull(),
    subcategory: text('subcategory').notNull(),
    tagsJson: text('tags_json').notNull(),
    sourceName: text('source_name'),
    sourceUrl: text('source_url'),
    season: text('season').notNull(),
    wikiPath: text('wiki_path').notNull(),
    status: text('status', { enum: KNOWLEDGE_ITEM_STATUSES }).notNull(),
    gitCommitSha: text('git_commit_sha'),
    wikiSyncStatus: text('wiki_sync_status', { enum: WIKI_SYNC_STATUSES }).notNull(),
    publishedBy: text('published_by')
      .notNull()
      .references(() => users.id),
    publishedAt: text('published_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_knowledge_items_wiki_path').on(table.wikiPath),
    index('idx_knowledge_items_category_sub').on(table.category, table.subcategory),
    index('idx_knowledge_items_source_id').on(table.sourceId),
  ],
);

export type KnowledgeItem = typeof knowledgeItems.$inferSelect;
export type NewKnowledgeItem = typeof knowledgeItems.$inferInsert;
