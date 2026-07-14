/**
 * Knowledge-evaluation repository — DB CRUD for evaluations, dimensions, feedback.
 *
 * All functions are synchronous (better-sqlite3 is sync).
 *
 * @module knowledge-evaluation/repository
 */

import { eq, and, desc, lt, inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  knowledgeEvaluations,
  evaluationDimensions,
  evaluationFeedback,
  knowledgeDrafts,
  knowledgeJobs,
  systemSettings,
  type KnowledgeEvaluation,
  type EvaluationDimension,
  type EvaluationFeedback,
} from '@/db/schema';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import type { EvaluationTier, EvaluationStatus, DimensionTier } from '@/config/constants';
import type { CursorPageResult } from '@/modules/knowledge/types';
import type { KnowledgeDraft } from '@/db/schema/knowledge';

// ---------------------------------------------------------------------------
// Evaluations
// ---------------------------------------------------------------------------

export function createEvaluation(params: {
  draftId: string;
  deepEval: boolean;
  evaluatedBy?: string | null;
}): KnowledgeEvaluation {
  const db = getDb();
  const now = utcNow();
  const id = generateId();
  const record = {
    id,
    draftId: params.draftId,
    targetType: 'draft' as const,
    tier: 'pending' as const,
    overallScore: 0,
    status: 'pending' as const,
    deepEval: params.deepEval,
    evaluatedBy: params.evaluatedBy ?? null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(knowledgeEvaluations).values(record).run();
  return { ...record } as KnowledgeEvaluation;
}

export function getEvaluation(id: string): KnowledgeEvaluation | null {
  const db = getDb();
  const r = db
    .select()
    .from(knowledgeEvaluations)
    .where(eq(knowledgeEvaluations.id, id))
    .limit(1)
    .all();
  return r[0] ?? null;
}

export function getEvaluationByDraftId(draftId: string): KnowledgeEvaluation | null {
  const db = getDb();
  const r = db
    .select()
    .from(knowledgeEvaluations)
    .where(eq(knowledgeEvaluations.draftId, draftId))
    .limit(1)
    .all();
  return r[0] ?? null;
}

export function updateEvaluation(
  id: string,
  changes: Partial<
    Pick<
      KnowledgeEvaluation,
      'tier' | 'overallScore' | 'status' | 'deepEval' | 'evaluatedBy' | 'errorMessage'
    >
  >,
): void {
  const db = getDb();
  const now = utcNow();
  db.update(knowledgeEvaluations)
    .set({ ...changes, updatedAt: now })
    .where(eq(knowledgeEvaluations.id, id))
    .run();
}

export function listEvaluations(params: {
  tier?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}): CursorPageResult<KnowledgeEvaluation> {
  const db = getDb();
  const limit = params.limit ?? 20;
  const conditions = [];
  if (params.tier) {
    conditions.push(eq(knowledgeEvaluations.tier, params.tier as EvaluationTier));
  }
  if (params.status) {
    conditions.push(eq(knowledgeEvaluations.status, params.status as EvaluationStatus));
  }
  if (params.cursor) {
    conditions.push(lt(knowledgeEvaluations.id, params.cursor));
  }
  const rows = db
    .select()
    .from(knowledgeEvaluations)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(knowledgeEvaluations.id))
    .limit(limit + 1)
    .all();
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

export function listDimensions(evaluationId: string): EvaluationDimension[] {
  const db = getDb();
  return db
    .select()
    .from(evaluationDimensions)
    .where(eq(evaluationDimensions.evaluationId, evaluationId))
    .all();
}

export function clearDimensions(evaluationId: string): void {
  const db = getDb();
  db.delete(evaluationDimensions)
    .where(eq(evaluationDimensions.evaluationId, evaluationId))
    .run();
}

export function insertDimension(params: {
  evaluationId: string;
  dimensionKey: string;
  tier: DimensionTier;
  score: number;
  weight: number;
  rationale?: string | null;
  detailJson?: string | null;
}): void {
  const db = getDb();
  const now = utcNow();
  const id = generateId();
  db.insert(evaluationDimensions)
    .values({
      id,
      evaluationId: params.evaluationId,
      dimensionKey: params.dimensionKey,
      tier: params.tier,
      score: params.score,
      weight: params.weight,
      rationale: params.rationale ?? null,
      detailJson: params.detailJson ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function createFeedback(params: {
  draftId: string;
  evaluationId?: string | null;
  authorId: string;
  dimensionRatingsJson?: string | null;
  comments?: string | null;
  improvementInstructionsJson?: string | null;
}): EvaluationFeedback {
  const db = getDb();
  const now = utcNow();
  const id = generateId();
  const record = {
    id,
    draftId: params.draftId,
    evaluationId: params.evaluationId ?? null,
    authorId: params.authorId,
    dimensionRatingsJson: params.dimensionRatingsJson ?? null,
    comments: params.comments ?? null,
    improvementInstructionsJson: params.improvementInstructionsJson ?? null,
    appliedToJobId: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(evaluationFeedback).values(record).run();
  return { ...record } as EvaluationFeedback;
}

export function listFeedbackByDraft(draftId: string): EvaluationFeedback[] {
  const db = getDb();
  return db
    .select()
    .from(evaluationFeedback)
    .where(eq(evaluationFeedback.draftId, draftId))
    .orderBy(desc(evaluationFeedback.createdAt))
    .all();
}

export function markFeedbackApplied(feedbackIds: string[], jobId: string): void {
  if (feedbackIds.length === 0) return;
  const db = getDb();
  const now = utcNow();
  db.update(evaluationFeedback)
    .set({ appliedToJobId: jobId, updatedAt: now })
    .where(inArray(evaluationFeedback.id, feedbackIds))
    .run();
}

// ---------------------------------------------------------------------------
// Draft versions (lineage via source)
// ---------------------------------------------------------------------------

/**
 * All drafts for the same source as the given draft, ordered by version DESC.
 * Re-clean enqueues a new job on the same source → new draft (version N+1).
 */
export function getDraftVersions(draftId: string): KnowledgeDraft[] {
  const db = getDb();
  const draft = db
    .select()
    .from(knowledgeDrafts)
    .where(eq(knowledgeDrafts.id, draftId))
    .limit(1)
    .all();
  if (draft.length === 0) return [];

  const job = db
    .select()
    .from(knowledgeJobs)
    .where(eq(knowledgeJobs.id, draft[0]!.jobId))
    .limit(1)
    .all();
  if (job.length === 0) return [draft[0]!];

  const allJobs = db
    .select()
    .from(knowledgeJobs)
    .where(eq(knowledgeJobs.sourceId, job[0]!.sourceId))
    .all();
  const jobIds = allJobs.map((j) => j.id);
  if (jobIds.length === 0) return [draft[0]!];

  return db
    .select()
    .from(knowledgeDrafts)
    .where(inArray(knowledgeDrafts.jobId, jobIds))
    .orderBy(desc(knowledgeDrafts.version))
    .all();
}

// ---------------------------------------------------------------------------
// Publish guard settings
// ---------------------------------------------------------------------------

/**
 * Read the publish-guard settings from `system_settings`.
 * - `knowledge.eval.publish_guard_enabled` ('true'/'false', default false)
 * - `knowledge.eval.publish_guard_min_score` (int, default 60)
 */
export function getPublishGuardSettings(): { enabled: boolean; minScore: number } {
  const db = getDb();
  const rows = db
    .select()
    .from(systemSettings)
    .where(
      inArray(systemSettings.key, [
        'knowledge.eval.publish_guard_enabled',
        'knowledge.eval.publish_guard_min_score',
      ]),
    )
    .all();
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  const minRaw = Number(map['knowledge.eval.publish_guard_min_score'] ?? 60);
  return {
    enabled: map['knowledge.eval.publish_guard_enabled'] === 'true',
    minScore: Number.isFinite(minRaw) ? minRaw : 60,
  };
}
