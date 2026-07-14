import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import {
  EVALUATION_TIERS,
  EVALUATION_STATUSES,
  DIMENSION_TIERS,
} from '../../config/constants';
import { users } from './users';
import { knowledgeDrafts, knowledgeJobs } from './knowledge';

// ─── knowledge_evaluations ───────────────────────────────────────────────────
// One row per draft evaluation. Re-clean produces a new draft → new evaluation.
// 1:1 with knowledge_drafts via uniqueIndex on draftId.

export const knowledgeEvaluations = sqliteTable(
  'knowledge_evaluations',
  {
    id: text('id').primaryKey(),
    draftId: text('draft_id')
      .notNull()
      .references(() => knowledgeDrafts.id),
    targetType: text('target_type', { enum: ['draft', 'item'] as const })
      .notNull()
      .default('draft'),
    tier: text('tier', { enum: EVALUATION_TIERS }).notNull().default('pending'),
    overallScore: integer('overall_score').notNull().default(0),
    status: text('status', { enum: EVALUATION_STATUSES }).notNull().default('pending'),
    deepEval: integer('deep_eval', { mode: 'boolean' }).notNull().default(false),
    evaluatedBy: text('evaluated_by').references(() => users.id),
    errorMessage: text('error_message'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_knowledge_evaluations_draft_id').on(table.draftId),
    index('idx_knowledge_evaluations_tier').on(table.tier),
    index('idx_knowledge_evaluations_status').on(table.status),
  ],
);

export type KnowledgeEvaluation = typeof knowledgeEvaluations.$inferSelect;
export type NewKnowledgeEvaluation = typeof knowledgeEvaluations.$inferInsert;

// ─── evaluation_dimensions ────────────────────────────────────────────────────
// Per-dimension scores for an evaluation. One row per (evaluationId, dimensionKey).

export const evaluationDimensions = sqliteTable(
  'evaluation_dimensions',
  {
    id: text('id').primaryKey(),
    evaluationId: text('evaluation_id')
      .notNull()
      .references(() => knowledgeEvaluations.id),
    dimensionKey: text('dimension_key').notNull(),
    tier: text('tier', { enum: DIMENSION_TIERS }).notNull(),
    score: integer('score').notNull(),
    weight: integer('weight').notNull(),
    rationale: text('rationale'),
    detailJson: text('detail_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_evaluation_dimensions_eval_key').on(
      table.evaluationId,
      table.dimensionKey,
    ),
    index('idx_evaluation_dimensions_evaluation_id').on(table.evaluationId),
  ],
);

export type EvaluationDimension = typeof evaluationDimensions.$inferSelect;
export type NewEvaluationDimension = typeof evaluationDimensions.$inferInsert;

// ─── evaluation_feedback ──────────────────────────────────────────────────────
// Admin feedback on a draft/evaluation. `applied_to_job_id` is set when a
// re-clean job is enqueued that consumes this feedback.

export const evaluationFeedback = sqliteTable(
  'evaluation_feedback',
  {
    id: text('id').primaryKey(),
    draftId: text('draft_id')
      .notNull()
      .references(() => knowledgeDrafts.id),
    evaluationId: text('evaluation_id').references(() => knowledgeEvaluations.id),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    dimensionRatingsJson: text('dimension_ratings_json'),
    comments: text('comments'),
    improvementInstructionsJson: text('improvement_instructions_json'),
    appliedToJobId: text('applied_to_job_id').references(() => knowledgeJobs.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_evaluation_feedback_draft_id').on(table.draftId),
    index('idx_evaluation_feedback_evaluation_id').on(table.evaluationId),
    index('idx_evaluation_feedback_applied').on(table.appliedToJobId),
  ],
);

export type EvaluationFeedback = typeof evaluationFeedback.$inferSelect;
export type NewEvaluationFeedback = typeof evaluationFeedback.$inferInsert;
