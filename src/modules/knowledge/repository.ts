/**
 * Knowledge repository — DB CRUD for sources, drafts, items.
 *
 * All functions are synchronous (better-sqlite3 is sync).
 *
 * @module knowledge/repository
 */

import { eq, and, desc, lt, inArray, ne, type SQL } from 'drizzle-orm';
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
import type { CursorPageParams, CursorPageResult } from './types';

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/**
 * Create a new knowledge source record.
 */
export function createSource(
  data: Omit<NewKnowledgeSource, 'id' | 'createdAt' | 'updatedAt'>,
): KnowledgeSource {
  const db = getDb();
  const now = utcNow();
  const id = generateId();
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
    conditions.push(eq(knowledgeSources.status, params.status as typeof knowledgeSources.status._.data));
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
  data: Omit<NewKnowledgeDraft, 'id' | 'createdAt' | 'updatedAt'>,
): KnowledgeDraft {
  const db = getDb();
  const now = utcNow();
  const id = generateId();
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
  const result = db
    .select()
    .from(knowledgeDrafts)
    .where(eq(knowledgeDrafts.id, id))
    .limit(1)
    .all();
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
  const jobs = db
    .select()
    .from(knowledgeJobs)
    .where(eq(knowledgeJobs.sourceId, sourceId))
    .all();

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

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/**
 * Create a new knowledge item.
 */
export function createItem(
  data: Omit<NewKnowledgeItem, 'id' | 'updatedAt'>,
): KnowledgeItem {
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
  const result = db
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.id, id))
    .limit(1)
    .all();
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
    conditions.push(eq(knowledgeItems.category, params.category as typeof knowledgeItems.category._.data));
  }
  if (params.status) {
    conditions.push(eq(knowledgeItems.status, params.status as typeof knowledgeItems.status._.data));
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
    .where(eq(knowledgeItems.wikiSyncStatus, syncStatus as typeof knowledgeItems.wikiSyncStatus._.data))
    .all();
}

/**
 * Update a knowledge item's metadata (for overwrite / re-publish scenarios).
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
export function updateSyncStatus(
  id: string,
  syncStatus: string,
  commitSha?: string,
): void {
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
