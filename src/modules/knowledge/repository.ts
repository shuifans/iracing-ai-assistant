/**
 * Knowledge repository — DB CRUD for sources, drafts, items.
 *
 * All functions are synchronous (better-sqlite3 is sync).
 *
 * @module knowledge/repository
 */

import { eq, and, desc, lt, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db/client';
import {
  knowledgeSources,
  knowledgeDrafts,
  knowledgeItems,
  knowledgeJobs,
  type KnowledgeSource,
  type KnowledgeDraft,
  type KnowledgeItem,
  type NewKnowledgeSource,
  type NewKnowledgeDraft,
  type NewKnowledgeItem,
} from '@/db/schema/knowledge';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import {
  knowledgeEvaluations,
  evaluationDimensions,
  evaluationFeedback,
} from '@/db/schema/evaluation';
import { auditLogs } from '@/db/schema/admin';
import { AppError } from '@/lib/errors';
import type { KnowledgeCategory, WikiSyncStatus } from '@/config/constants';
import type {
  CursorPageParams,
  CursorPageResult,
  DraftListRow,
  KnowledgeStats,
  CountBucket,
} from './types';

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/**
 * Create a new knowledge source record.
 */
export function createSource(
  data: Omit<NewKnowledgeSource, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): KnowledgeSource {
  const db = getDb();
  const now = utcNow();
  // Allow callers to pass a predetermined id — the submit flow generates one
  // up-front to name the upload dir + relative_path before the DB insert, and
  // must reuse that same id for the job + return value (otherwise the job's
  // source_id FK references a never-persisted row → SQLITE_CONSTRAINT_FOREIGNKEY).
  const id = data.id ?? generateId();
  const record: NewKnowledgeSource = {
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(knowledgeSources).values(record).run();
  return { ...record } as KnowledgeSource;
}

/**
 * Get a knowledge source by ID.
 */
export function getSource(id: string): KnowledgeSource | null {
  const db = getDb();
  const result = db
    .select()
    .from(knowledgeSources)
    .where(eq(knowledgeSources.id, id))
    .limit(1)
    .all();
  return result[0] ?? null;
}

/**
 * List knowledge sources with cursor-based pagination.
 */
export function listSources(
  params: CursorPageParams & { status?: string },
): CursorPageResult<KnowledgeSource> {
  const db = getDb();
  const limit = params.limit ?? 20;

  const conditions = [];
  if (params.status) {
    conditions.push(
      eq(knowledgeSources.status, params.status as typeof knowledgeSources.status._.data),
    );
  }
  if (params.cursor) {
    // Use id (UUIDv7, time-ordered) as cursor to avoid same-timestamp pagination gaps
    conditions.push(lt(knowledgeSources.id, params.cursor));
  }

  const rows = db
    .select()
    .from(knowledgeSources)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(knowledgeSources.id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]!.id : null,
  };
}

/**
 * Find a duplicate source by SHA-256 hash.
 */
export function findDuplicateBySha256(sha256: string): KnowledgeSource | null {
  const db = getDb();
  const result = db
    .select()
    .from(knowledgeSources)
    .where(eq(knowledgeSources.sha256, sha256))
    .limit(1)
    .all();
  return result[0] ?? null;
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

/**
 * Create a new knowledge draft.
 */
export function createDraft(
  data: Omit<NewKnowledgeDraft, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): KnowledgeDraft {
  const db = getDb();
  const now = utcNow();
  const id = data.id ?? generateId();
  const record: NewKnowledgeDraft = {
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(knowledgeDrafts).values(record).run();
  return { ...record } as KnowledgeDraft;
}

/**
 * Get a draft by ID.
 */
export function getDraft(id: string): KnowledgeDraft | null {
  const db = getDb();
  const result = db.select().from(knowledgeDrafts).where(eq(knowledgeDrafts.id, id)).limit(1).all();
  return result[0] ?? null;
}

/**
 * Get a draft by job_id (UNIQUE constraint).
 */
export function getDraftByJobId(jobId: string): KnowledgeDraft | null {
  const db = getDb();
  const result = db
    .select()
    .from(knowledgeDrafts)
    .where(eq(knowledgeDrafts.jobId, jobId))
    .limit(1)
    .all();
  return result[0] ?? null;
}

/**
 * Update a draft with partial changes.
 */
export function updateDraft(
  id: string,
  changes: Partial<
    Pick<
      KnowledgeDraft,
      | 'suggestedPath'
      | 'title'
      | 'frontMatterJson'
      | 'draftRelativePath'
      | 'contentSha256'
      | 'status'
      | 'reviewNotes'
      | 'reviewedBy'
      | 'reviewedAt'
    >
  >,
): void {
  const db = getDb();
  const now = utcNow();
  db.update(knowledgeDrafts)
    .set({ ...changes, updatedAt: now })
    .where(eq(knowledgeDrafts.id, id))
    .run();
}

/**
 * Supersede all other pending drafts for the same source.
 * Finds drafts via jobs that belong to the given sourceId,
 * excluding the currentDraftId, and marks pending ones as superseded.
 */
export function supersedeOldDrafts(sourceId: string, currentDraftId: string): void {
  const db = getDb();
  const now = utcNow();

  // Find job IDs for this source
  const jobs = db.select().from(knowledgeJobs).where(eq(knowledgeJobs.sourceId, sourceId)).all();

  const jobIds = jobs.map((j) => j.id);
  if (jobIds.length === 0) return;

  db.update(knowledgeDrafts)
    .set({ status: 'superseded' as const, updatedAt: now })
    .where(
      and(
        inArray(knowledgeDrafts.jobId, jobIds),
        ne(knowledgeDrafts.id, currentDraftId),
        eq(knowledgeDrafts.status, 'pending_review'),
      ),
    )
    .run();
}

/**
 * List knowledge drafts with cursor-based pagination, enriched with the
 * best-effort evaluation (tier / overallScore) and source display name.
 *
 * Left-joins knowledge_evaluations (1:1 via draftId) and the job→source chain
 * so the admin 候选稿 tab can show tier + source without N+1 queries. Filters
 * by draft status, evaluation tier, and sourceId (via job.source_id).
 */
export function listDrafts(
  params: CursorPageParams & {
    status?: string;
    sourceId?: string;
    tier?: string;
    pendingPublish?: boolean;
  },
): CursorPageResult<DraftListRow> {
  const db = getDb();
  const limit = params.limit ?? 20;

  const conditions: SQL[] = [];
  if (params.status) {
    conditions.push(
      eq(knowledgeDrafts.status, params.status as typeof knowledgeDrafts.status._.data),
    );
  }
  if (params.pendingPublish) {
    // Approved drafts whose job has not gone through publish yet.
    conditions.push(eq(knowledgeDrafts.status, 'approved'));
    conditions.push(eq(knowledgeJobs.status, 'approved'));
  }
  if (params.tier) {
    conditions.push(
      eq(knowledgeEvaluations.tier, params.tier as typeof knowledgeEvaluations.tier._.data),
    );
  }
  if (params.sourceId) {
    conditions.push(eq(knowledgeJobs.sourceId, params.sourceId));
  }
  if (params.cursor) {
    conditions.push(lt(knowledgeDrafts.id, params.cursor));
  }

  const rows = db
    .select({
      draft: knowledgeDrafts,
      tier: knowledgeEvaluations.tier,
      overallScore: knowledgeEvaluations.overallScore,
      evalStatus: knowledgeEvaluations.status,
      jobStatus: knowledgeJobs.status,
      sourceOriginalName: knowledgeSources.originalName,
      sourceUrl: knowledgeSources.sourceUrl,
    })
    .from(knowledgeDrafts)
    .leftJoin(knowledgeEvaluations, eq(knowledgeEvaluations.draftId, knowledgeDrafts.id))
    .leftJoin(knowledgeJobs, eq(knowledgeJobs.id, knowledgeDrafts.jobId))
    .leftJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeJobs.sourceId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(knowledgeDrafts.id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows) as DraftListRow[];

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]!.draft.id : null,
  };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/**
 * Create a new knowledge item.
 */
export function createItem(data: Omit<NewKnowledgeItem, 'id' | 'updatedAt'>): KnowledgeItem {
  const db = getDb();
  const now = utcNow();
  const id = generateId();
  const record: NewKnowledgeItem = {
    ...data,
    id,
    updatedAt: now,
  };

  db.insert(knowledgeItems).values(record).run();
  return { ...record } as KnowledgeItem;
}

/**
 * Get a knowledge item by ID.
 */
export function getItem(id: string): KnowledgeItem | null {
  const db = getDb();
  const result = db.select().from(knowledgeItems).where(eq(knowledgeItems.id, id)).limit(1).all();
  return result[0] ?? null;
}

/**
 * Get a knowledge item by wiki_path (UNIQUE constraint).
 */
export function getItemByWikiPath(wikiPath: string): KnowledgeItem | null {
  const db = getDb();
  const result = db
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.wikiPath, wikiPath))
    .limit(1)
    .all();
  return result[0] ?? null;
}

/**
 * List knowledge items with cursor-based pagination.
 */
export function listItems(
  params: CursorPageParams & { category?: string; status?: string },
): CursorPageResult<KnowledgeItem> {
  const db = getDb();
  const limit = params.limit ?? 20;

  const conditions = [];
  if (params.category) {
    conditions.push(
      eq(knowledgeItems.category, params.category as typeof knowledgeItems.category._.data),
    );
  }
  if (params.status) {
    conditions.push(
      eq(knowledgeItems.status, params.status as typeof knowledgeItems.status._.data),
    );
  }
  if (params.cursor) {
    conditions.push(lt(knowledgeItems.publishedAt, params.cursor));
  }

  const rows = db
    .select()
    .from(knowledgeItems)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(knowledgeItems.publishedAt))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]!.publishedAt : null,
  };
}

/**
 * Archive a knowledge item (set status='archived').
 */
export function archiveItem(id: string): void {
  const db = getDb();
  const now = utcNow();
  db.update(knowledgeItems)
    .set({ status: 'archived' as const, updatedAt: now })
    .where(eq(knowledgeItems.id, id))
    .run();
}

/**
 * Restore a knowledge item (set status='published').
 */
export function restoreItem(id: string): void {
  const db = getDb();
  const now = utcNow();
  db.update(knowledgeItems)
    .set({ status: 'published' as const, updatedAt: now })
    .where(eq(knowledgeItems.id, id))
    .run();
}

/**
 * List knowledge items filtered by wiki_sync_status.
 */
export function listItemsBySyncStatus(syncStatus: string): KnowledgeItem[] {
  const db = getDb();
  return db
    .select()
    .from(knowledgeItems)
    .where(
      eq(knowledgeItems.wikiSyncStatus, syncStatus as typeof knowledgeItems.wikiSyncStatus._.data),
    )
    .all();
}

/**
 * Update a knowledge item's metadata (for overwrite / re-publish scenarios).
 *
 * draftId + status are included so the publisher's overwrite branch can point
 * an existing item at the revised draft and reset an archived item back to
 * 'published' when a revision is approved.
 */
export function updateItem(
  id: string,
  changes: Partial<
    Pick<
      KnowledgeItem,
      | 'title'
      | 'category'
      | 'subcategory'
      | 'tagsJson'
      | 'sourceName'
      | 'sourceUrl'
      | 'season'
      | 'wikiSyncStatus'
      | 'gitCommitSha'
      | 'publishedBy'
      | 'publishedAt'
      | 'draftId'
      | 'status'
    >
  >,
): void {
  const db = getDb();
  const now = utcNow();
  db.update(knowledgeItems)
    .set({ ...changes, updatedAt: now })
    .where(eq(knowledgeItems.id, id))
    .run();
}

/**
 * Update the wiki sync status of a knowledge item.
 */
export function updateSyncStatus(id: string, syncStatus: WikiSyncStatus, commitSha?: string): void {
  const db = getDb();
  const now = utcNow();
  const changes: Record<string, string> = {
    wikiSyncStatus: syncStatus,
    updatedAt: now,
  };
  if (commitSha !== undefined) {
    changes.gitCommitSha = commitSha;
  }
  db.update(knowledgeItems).set(changes).where(eq(knowledgeItems.id, id)).run();
}

/**
 * Complete one specific asynchronous push attempt. The expected pending state
 * and commit SHA prevent an older child process from overwriting a newer
 * publication of the same item.
 */
export function completePushAttempt(
  id: string,
  expectedCommitSha: string,
  finalStatus: Extract<WikiSyncStatus, 'synced' | 'push_failed'>,
): boolean {
  const db = getDb();
  const result = db
    .update(knowledgeItems)
    .set({ wikiSyncStatus: finalStatus, updatedAt: utcNow() })
    .where(
      and(
        eq(knowledgeItems.id, id),
        eq(knowledgeItems.wikiSyncStatus, 'push_pending'),
        eq(knowledgeItems.gitCommitSha, expectedCommitSha),
      ),
    )
    .run();
  return result.changes === 1;
}

export interface CommitPublishedDraftInput {
  jobId: string;
  draftId: string;
  reviewedBy: string;
  wikiPath: string;
  title: string;
  category: KnowledgeCategory;
  subcategory: string;
  tagsJson: string;
  sourceName: string | null;
  sourceUrl: string | null;
  season: string;
  publishedAt: string;
}

/**
 * Persist the published item, review decision, terminal job transition, and
 * audit record as one SQLite transaction.
 */
export function commitPublishedDraft(input: CommitPublishedDraftInput): { itemId: string } {
  const db = getDb();

  return db.transaction((tx) => {
    const job = tx
      .select()
      .from(knowledgeJobs)
      .where(eq(knowledgeJobs.id, input.jobId))
      .limit(1)
      .all()[0];
    if (!job) {
      throw new AppError('NOT_FOUND', 'Knowledge job not found');
    }

    const now = utcNow();
    const existing = tx
      .select()
      .from(knowledgeItems)
      .where(eq(knowledgeItems.wikiPath, input.wikiPath))
      .limit(1)
      .all()[0];
    if (existing && existing.sourceId !== job.sourceId) {
      throw new AppError(
        'CONFLICT',
        `Wiki path is already owned by another source: ${input.wikiPath}`,
      );
    }
    const itemId = existing?.id ?? generateId();
    const itemChanges = {
      draftId: input.draftId,
      title: input.title,
      category: input.category,
      subcategory: input.subcategory,
      tagsJson: input.tagsJson,
      sourceName: input.sourceName,
      sourceUrl: input.sourceUrl,
      season: input.season,
      status: 'published' as const,
      gitCommitSha: null,
      wikiSyncStatus: 'committed' as const,
      publishedBy: input.reviewedBy,
      publishedAt: input.publishedAt,
      updatedAt: now,
    };

    if (existing) {
      tx.update(knowledgeItems).set(itemChanges).where(eq(knowledgeItems.id, itemId)).run();
    } else {
      tx.insert(knowledgeItems)
        .values({
          id: itemId,
          sourceId: job.sourceId,
          wikiPath: input.wikiPath,
          ...itemChanges,
        })
        .run();
    }

    const siblingJobs = tx
      .select({ id: knowledgeJobs.id })
      .from(knowledgeJobs)
      .where(eq(knowledgeJobs.sourceId, job.sourceId))
      .all();
    if (siblingJobs.length > 0) {
      tx.update(knowledgeDrafts)
        .set({ status: 'superseded', updatedAt: now })
        .where(
          and(
            inArray(
              knowledgeDrafts.jobId,
              siblingJobs.map((row) => row.id),
            ),
            ne(knowledgeDrafts.id, input.draftId),
            eq(knowledgeDrafts.status, 'pending_review'),
          ),
        )
        .run();
    }

    tx.update(knowledgeDrafts)
      .set({
        status: 'approved',
        reviewedBy: input.reviewedBy,
        reviewedAt: input.publishedAt,
        updatedAt: now,
      })
      .where(eq(knowledgeDrafts.id, input.draftId))
      .run();

    const jobResult = tx
      .update(knowledgeJobs)
      .set({ status: 'published', updatedAt: now })
      .where(and(eq(knowledgeJobs.id, input.jobId), eq(knowledgeJobs.status, 'publishing')))
      .run();
    if (jobResult.changes !== 1) {
      throw new AppError('INVALID_STATE', 'Knowledge job is not in publishing state');
    }

    tx.insert(auditLogs)
      .values({
        id: generateId(),
        actorId: input.reviewedBy,
        action: 'knowledge.published',
        resource: 'knowledge_item',
        resourceId: itemId,
        requestId: null,
        ipHash: null,
        changesJson: JSON.stringify({ draftId: input.draftId, wikiPath: input.wikiPath }),
        createdAt: now,
      })
      .run();

    return { itemId };
  });
}

/**
 * Aggregate knowledge-base statistics for the admin 概览 dashboard.
 *
 * Single-pass counts over items / drafts / sources / jobs + a join of
 * published items → draft → evaluation for the tier distribution. All queries
 * are synchronous (better-sqlite3) and run against small admin datasets.
 */
export function getKnowledgeStats(): KnowledgeStats {
  const db = getDb();

  const itemsByStatus = db
    .select({ status: knowledgeItems.status, count: sql<number>`count(*)` })
    .from(knowledgeItems)
    .groupBy(knowledgeItems.status)
    .all()
    .map((r) => ({ key: r.status, count: r.count }));

  const itemsByCategory = db
    .select({ category: knowledgeItems.category, count: sql<number>`count(*)` })
    .from(knowledgeItems)
    .groupBy(knowledgeItems.category)
    .all()
    .map((r) => ({ key: r.category, count: r.count }));

  const itemsTotal =
    db
      .select({ c: sql<number>`count(*)` })
      .from(knowledgeItems)
      .all()[0]?.c ?? 0;

  const draftsByStatus = db
    .select({ status: knowledgeDrafts.status, count: sql<number>`count(*)` })
    .from(knowledgeDrafts)
    .groupBy(knowledgeDrafts.status)
    .all()
    .map((r) => ({ key: r.status, count: r.count }));

  const draftsTotal =
    db
      .select({ c: sql<number>`count(*)` })
      .from(knowledgeDrafts)
      .all()[0]?.c ?? 0;

  const reviewQueue = draftsByStatus.find((d) => d.key === 'pending_review')?.count ?? 0;

  const sourcesTotal =
    db
      .select({ c: sql<number>`count(*)` })
      .from(knowledgeSources)
      .all()[0]?.c ?? 0;

  const jobsByStatus = db
    .select({ status: knowledgeJobs.status, count: sql<number>`count(*)` })
    .from(knowledgeJobs)
    .groupBy(knowledgeJobs.status)
    .all()
    .map((r) => ({ key: r.status, count: r.count }));

  const reCleanJobsTotal =
    db
      .select({ c: sql<number>`count(*)` })
      .from(knowledgeJobs)
      .where(eq(knowledgeJobs.jobKind, 're_clean'))
      .all()[0]?.c ?? 0;

  const draftsByVersion = db
    .select({ version: knowledgeDrafts.version, count: sql<number>`count(*)` })
    .from(knowledgeDrafts)
    .groupBy(knowledgeDrafts.version)
    .all();

  // Tier distribution across published items: item → draft → evaluation.tier.
  // Items without an evaluation collapse to the 'pending' bucket.
  const tierDist = db
    .select({ tier: knowledgeEvaluations.tier, count: sql<number>`count(*)` })
    .from(knowledgeItems)
    .leftJoin(knowledgeDrafts, eq(knowledgeDrafts.id, knowledgeItems.draftId))
    .leftJoin(knowledgeEvaluations, eq(knowledgeEvaluations.draftId, knowledgeDrafts.id))
    .where(eq(knowledgeItems.status, 'published'))
    .groupBy(knowledgeEvaluations.tier)
    .all()
    .map((r) => ({ key: r.tier ?? 'pending', count: r.count }));

  const jobCount = (statuses: string[]) =>
    jobsByStatus.filter((j) => statuses.includes(j.key)).reduce((sum, j) => sum + j.count, 0);

  return {
    items: { byStatus: itemsByStatus, byCategory: itemsByCategory, total: itemsTotal },
    drafts: { byStatus: draftsByStatus, reviewQueue, total: draftsTotal },
    sources: { total: sourcesTotal },
    jobs: { byStatus: jobsByStatus },
    workflow: {
      imported: jobCount(['queued', 'paused', 'extracting']),
      cleaning: jobCount(['cleaning']),
      pendingReview: jobCount(['pending_review']),
      approvedPending: jobCount(['approved']),
    },
    reClean: { jobsTotal: reCleanJobsTotal, byVersion: draftsByVersion },
    tierDistribution: tierDist,
  };
}

// ---------------------------------------------------------------------------
// Deletion (cascading, FK-safe)
// ---------------------------------------------------------------------------

// Terminal job states eligible for deletion from the task list.
export const DELETABLE_JOB_STATUSES = ['published', 'rejected', 'failed', 'cancelled'] as const;

/**
 * Delete a terminal-state job and its dependent rows (draft, evaluations,
 * dimensions, feedback) in one transaction. Blocked when a knowledge_item
 * still references the job's draft — the item must be deleted first.
 *
 * Returns the deleted draft's relative path (for file cleanup) if one existed.
 */
export function deleteJobCascade(
  jobId: string,
  actorId: string,
): { draftRelativePath: string | null } {
  const db = getDb();

  return db.transaction((tx) => {
    const job = tx
      .select()
      .from(knowledgeJobs)
      .where(eq(knowledgeJobs.id, jobId))
      .limit(1)
      .all()[0];
    if (!job) {
      throw new AppError('NOT_FOUND', `Job ${jobId} not found`);
    }
    if (!(DELETABLE_JOB_STATUSES as readonly string[]).includes(job.status)) {
      throw new AppError(
        'INVALID_STATE',
        `只有终态任务（published/rejected/failed/cancelled）可删除，当前 '${job.status}'`,
      );
    }

    const draft = tx
      .select()
      .from(knowledgeDrafts)
      .where(eq(knowledgeDrafts.jobId, jobId))
      .limit(1)
      .all()[0];

    let draftRelativePath: string | null = null;
    if (draft) {
      const referencingItem = tx
        .select({ id: knowledgeItems.id })
        .from(knowledgeItems)
        .where(eq(knowledgeItems.draftId, draft.id))
        .limit(1)
        .all()[0];
      if (referencingItem) {
        throw new AppError(
          'INVALID_STATE',
          '该任务的草稿已发布为知识条目，请先在「管理知识」中删除对应条目',
        );
      }

      const evals = tx
        .select({ id: knowledgeEvaluations.id })
        .from(knowledgeEvaluations)
        .where(eq(knowledgeEvaluations.draftId, draft.id))
        .all();
      const evalIds = evals.map((e) => e.id);
      if (evalIds.length > 0) {
        tx.delete(evaluationDimensions)
          .where(inArray(evaluationDimensions.evaluationId, evalIds))
          .run();
      }
      tx.delete(evaluationFeedback).where(eq(evaluationFeedback.draftId, draft.id)).run();
      if (evalIds.length > 0) {
        tx.delete(knowledgeEvaluations).where(inArray(knowledgeEvaluations.id, evalIds)).run();
      }
      tx.delete(knowledgeDrafts).where(eq(knowledgeDrafts.id, draft.id)).run();
      draftRelativePath = draft.draftRelativePath;
    }

    // Feedback rows from other drafts that reference this job (applied_to_job_id FK).
    tx.update(evaluationFeedback)
      .set({ appliedToJobId: null, updatedAt: utcNow() })
      .where(eq(evaluationFeedback.appliedToJobId, jobId))
      .run();

    tx.delete(knowledgeJobs).where(eq(knowledgeJobs.id, jobId)).run();

    tx.insert(auditLogs)
      .values({
        id: generateId(),
        actorId,
        action: 'knowledge.job_deleted',
        resource: 'knowledge_job',
        resourceId: jobId,
        requestId: null,
        ipHash: null,
        changesJson: JSON.stringify({ status: job.status, draftId: draft?.id ?? null }),
        createdAt: utcNow(),
      })
      .run();

    return { draftRelativePath };
  });
}

/**
 * Delete an archived knowledge item row (+ audit). The wiki file removal and
 * git commit are handled by the service layer before this is called.
 */
export function deleteItem(itemId: string, actorId: string): void {
  const db = getDb();

  db.transaction((tx) => {
    tx.delete(knowledgeItems).where(eq(knowledgeItems.id, itemId)).run();
    tx.insert(auditLogs)
      .values({
        id: generateId(),
        actorId,
        action: 'knowledge.item_deleted',
        resource: 'knowledge_item',
        resourceId: itemId,
        requestId: null,
        ipHash: null,
        changesJson: null,
        createdAt: utcNow(),
      })
      .run();
  });
}
