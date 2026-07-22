/**
 * Jobs repository — DB CRUD for knowledge processing job queue with CAS lease mechanism.
 *
 * All functions are synchronous (better-sqlite3 is sync).
 * CAS (Compare-And-Swap) is used for atomic status transitions and lease operations.
 *
 * @module jobs/repository
 */

import { eq, and, desc, lte, lt, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { knowledgeJobs, type KnowledgeJob } from '@/db/schema/knowledge';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import { JOB_STATUSES } from '@/config/constants';
import { env } from '@/config/env';
import type { ClaimResult, LeasedJob } from './types';

// Only active worker execution states own a recoverable lease.
const LEASED_EXECUTION_STATUSES = ['extracting', 'cleaning'] as const;

// ---------------------------------------------------------------------------
// Basic CRUD
// ---------------------------------------------------------------------------

/**
 * Enqueue a new knowledge processing job for a source (plain cleaning job).
 */
export function enqueueJob(sourceId: string): KnowledgeJob {
  return enqueueJobWith(sourceId, {});
}

/**
 * Enqueue a knowledge processing job carrying reviewer feedback for a re-clean.
 *
 * Used by the evaluation feedback loop: `instructionsJson` is forwarded to the
 * knowledge-cleaner sub-agent; `parentDraftId` links the new draft to its
 * predecessor for version history; `kind: 're_clean'` distinguishes it from
 * an initial clean.
 */
export function enqueueJobWithInstructions(
  sourceId: string,
  opts: {
    instructionsJson?: string | null;
    parentDraftId?: string | null;
    kind?: 'clean' | 're_clean';
  },
): KnowledgeJob {
  return enqueueJobWith(sourceId, opts);
}

function enqueueJobWith(
  sourceId: string,
  opts: {
    instructionsJson?: string | null;
    parentDraftId?: string | null;
    kind?: 'clean' | 're_clean';
  },
): KnowledgeJob {
  const db = getDb();
  const now = utcNow();
  const id = generateId();
  const job: KnowledgeJob = {
    id,
    sourceId,
    status: 'queued',
    attempt: 0,
    maxAttempts: 3,
    availableAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    progress: 0,
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    instructionsJson: opts.instructionsJson ?? null,
    parentDraftId: opts.parentDraftId ?? null,
    jobKind: opts.kind ?? 'clean',
    createdAt: now,
    updatedAt: now,
  };

  db.insert(knowledgeJobs).values(job).run();
  return job;
}

/**
 * Create a review-only job that skips the cleaning pipeline and lands directly
 * in `pending_review`.
 *
 * Used by the revision flow (reviseItem): the revised draft is a verbatim copy
 * of an already-published item, so no extraction/cleaning is needed — the admin
 * reviews it directly. The job is inserted with a null lease: claimJob() only
 * claims `queued` jobs, and recoverExpiredLeases() only touches rows whose
 * `leaseExpiresAt` is non-null (NULL < now is false in SQL), so this job is
 * never picked up by the worker. approve() later CAS-transitions
 * pending_review → publishing as normal.
 */
export function createReviewJob(
  sourceId: string,
  opts: {
    parentDraftId?: string | null;
    kind?: 'clean' | 're_clean';
  },
): KnowledgeJob {
  const db = getDb();
  const now = utcNow();
  const id = generateId();
  const job: KnowledgeJob = {
    id,
    sourceId,
    status: 'pending_review',
    attempt: 0,
    maxAttempts: 3,
    availableAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    progress: 100,
    errorCode: null,
    errorMessage: null,
    startedAt: now,
    finishedAt: now,
    instructionsJson: null,
    parentDraftId: opts.parentDraftId ?? null,
    jobKind: opts.kind ?? 're_clean',
    createdAt: now,
    updatedAt: now,
  };

  db.insert(knowledgeJobs).values(job).run();
  return job;
}

/**
 * Get a job by ID.
 */
export function getJob(id: string): KnowledgeJob | null {
  const db = getDb();
  const result = db.select().from(knowledgeJobs).where(eq(knowledgeJobs.id, id)).limit(1).all();
  return result[0] ?? null;
}

/**
 * List jobs with cursor-based pagination, ordered by created_at DESC.
 */
export function listJobs(params: {
  limit?: number;
  cursor?: string;
  status?: string;
  sourceId?: string;
}): { jobs: KnowledgeJob[]; nextCursor: string | null } {
  const db = getDb();
  const limit = params.limit ?? 20;

  const conditions = [];
  if (params.status) {
    const statuses = params.status
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as (typeof JOB_STATUSES)[number][];
    if (statuses.length === 1) {
      conditions.push(eq(knowledgeJobs.status, statuses[0]!));
    } else if (statuses.length > 1) {
      conditions.push(inArray(knowledgeJobs.status, statuses));
    }
  }
  if (params.sourceId) {
    conditions.push(eq(knowledgeJobs.sourceId, params.sourceId));
  }
  if (params.cursor) {
    // Use id (UUIDv7, time-ordered) as cursor to avoid same-timestamp pagination gaps
    conditions.push(lt(knowledgeJobs.id, params.cursor));
  }

  const rows = db
    .select()
    .from(knowledgeJobs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(knowledgeJobs.id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    jobs: resultRows,
    nextCursor: hasMore ? resultRows[resultRows.length - 1]!.id : null,
  };
}

// ---------------------------------------------------------------------------
// CAS Lease Operations
// ---------------------------------------------------------------------------

/**
 * Claim the next available queued job using CAS (Compare-And-Swap).
 *
 * Two-step atomic operation:
 * 1. SELECT the oldest queued job that is available
 * 2. UPDATE ... WHERE status='queued' — CAS check ensures atomicity
 */
export function claimJob(workerId: string): ClaimResult {
  const db = getDb();
  const now = utcNow();
  const leaseSeconds = env.KNOWLEDGE_JOB_LEASE_SECONDS as number;

  // Calculate lease expiry
  const expiresAt = new Date(new Date(now).getTime() + leaseSeconds * 1000).toISOString();

  // Step 1: Find oldest available queued job
  const candidates = db
    .select()
    .from(knowledgeJobs)
    .where(and(eq(knowledgeJobs.status, 'queued'), lte(knowledgeJobs.availableAt, now)))
    .orderBy(knowledgeJobs.createdAt)
    .limit(1)
    .all();

  if (candidates.length === 0) {
    return { claimed: false, job: null };
  }

  const candidate = candidates[0]!;

  // Step 2: CAS UPDATE — only succeeds if status is still 'queued'
  const result = db
    .update(knowledgeJobs)
    .set({
      status: 'extracting',
      leaseOwner: workerId,
      leaseExpiresAt: expiresAt,
      startedAt: now,
      updatedAt: now,
    })
    .where(and(eq(knowledgeJobs.id, candidate.id), eq(knowledgeJobs.status, 'queued')))
    .run();

  if (result.changes === 0) {
    return { claimed: false, job: null };
  }

  return {
    claimed: true,
    job: {
      id: candidate.id,
      sourceId: candidate.sourceId,
      status: 'extracting',
      leaseOwner: workerId,
      leaseExpiresAt: expiresAt,
      attempt: candidate.attempt,
      instructionsJson: candidate.instructionsJson,
      parentDraftId: candidate.parentDraftId,
      jobKind: candidate.jobKind,
    },
  };
}

/**
 * Extend the lease on a job (heartbeat). Only succeeds if lease_owner matches.
 */
export function heartbeatJob(jobId: string, workerId: string): void {
  const db = getDb();
  const now = utcNow();
  const leaseSeconds = env.KNOWLEDGE_JOB_LEASE_SECONDS as number;
  const expiresAt = new Date(new Date(now).getTime() + leaseSeconds * 1000).toISOString();

  db.update(knowledgeJobs)
    .set({ leaseExpiresAt: expiresAt, heartbeatAt: now, updatedAt: now })
    .where(and(eq(knowledgeJobs.id, jobId), eq(knowledgeJobs.leaseOwner, workerId)))
    .run();
}

/**
 * Release a job's lease without changing its status.
 */
export function releaseJob(jobId: string): void {
  const db = getDb();
  const now = utcNow();

  db.update(knowledgeJobs)
    .set({ leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
    .where(eq(knowledgeJobs.id, jobId))
    .run();
}

// ---------------------------------------------------------------------------
// Status Transitions (CAS)
// ---------------------------------------------------------------------------

/**
 * CAS status transition: only succeeds if current status matches fromStatus.
 * Returns true if the transition was applied.
 */
export function updateJobStatus(
  id: string,
  fromStatus: string,
  toStatus: string,
  extra?: Record<string, any>,
): boolean {
  const db = getDb();
  const now = utcNow();

  const result = db
    .update(knowledgeJobs)
    .set({
      status: toStatus as (typeof JOB_STATUSES)[number],
      updatedAt: now,
      ...extra,
    })
    .where(
      and(
        eq(knowledgeJobs.id, id),
        eq(knowledgeJobs.status, fromStatus as (typeof JOB_STATUSES)[number]),
      ),
    )
    .run();

  return result.changes > 0;
}

/**
 * Mark a job as failed with error details.
 */
export function failJob(id: string, errorCode: string, errorMessage: string): void {
  const db = getDb();
  const now = utcNow();

  db.update(knowledgeJobs)
    .set({
      status: 'failed',
      errorCode,
      errorMessage,
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(knowledgeJobs.id, id))
    .run();
}

/**
 * Mark an actively cleaning job as complete (pending_review), atomically
 * ending its worker lease. Returns true if the CAS transition was applied.
 */
export function completeJob(id: string): boolean {
  const db = getDb();
  const now = utcNow();

  const result = db
    .update(knowledgeJobs)
    .set({
      status: 'pending_review',
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(and(eq(knowledgeJobs.id, id), eq(knowledgeJobs.status, 'cleaning')))
    .run();

  return result.changes > 0;
}

/**
 * Retry a failed job: CAS WHERE status='failed', reset to queued with backoff delay.
 * Backoff: attempt * 60 seconds.
 * Returns true if the retry was applied.
 */
export function retryJob(id: string): boolean {
  const db = getDb();
  const now = utcNow();

  // Get current job to compute backoff and increment attempt
  const current = db.select().from(knowledgeJobs).where(eq(knowledgeJobs.id, id)).limit(1).all();

  if (current.length === 0 || current[0]!.status !== 'failed') {
    return false;
  }

  const job = current[0]!;
  const newAttempt = job.attempt + 1;
  const backoffSeconds = newAttempt * 60;
  const availableAt = new Date(new Date(now).getTime() + backoffSeconds * 1000).toISOString();

  const result = db
    .update(knowledgeJobs)
    .set({
      status: 'queued',
      attempt: newAttempt,
      availableAt,
      errorCode: null,
      errorMessage: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      finishedAt: null,
      updatedAt: now,
    })
    .where(and(eq(knowledgeJobs.id, id), eq(knowledgeJobs.status, 'failed')))
    .run();

  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

/**
 * Cancel a queued or paused job. CAS: only succeeds if status is queued/paused.
 * Returns true if the cancellation was applied.
 */
export function cancelJob(id: string): boolean {
  const db = getDb();
  const now = utcNow();

  const result = db
    .update(knowledgeJobs)
    .set({
      status: 'cancelled',
      finishedAt: now,
      updatedAt: now,
    })
    .where(and(eq(knowledgeJobs.id, id), inArray(knowledgeJobs.status, ['queued', 'paused'])))
    .run();

  return result.changes > 0;
}

/**
 * Pause a queued job. CAS: only succeeds if status='queued'.
 */
export function pauseJob(id: string): boolean {
  const db = getDb();
  const now = utcNow();

  const result = db
    .update(knowledgeJobs)
    .set({ status: 'paused', updatedAt: now })
    .where(and(eq(knowledgeJobs.id, id), eq(knowledgeJobs.status, 'queued')))
    .run();

  return result.changes > 0;
}

/**
 * Resume a paused job back to the queue. CAS: only succeeds if status='paused'.
 */
export function resumeJob(id: string): boolean {
  const db = getDb();
  const now = utcNow();

  const result = db
    .update(knowledgeJobs)
    .set({ status: 'queued', availableAt: now, updatedAt: now })
    .where(and(eq(knowledgeJobs.id, id), eq(knowledgeJobs.status, 'paused')))
    .run();

  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

/**
 * Recover active worker executions with expired leases.
 * Resets them to 'queued' with lease cleared. Returns count of recovered jobs.
 */
export function recoverExpiredLeases(): number {
  const db = getDb();
  const now = utcNow();

  // Find expired active worker executions.
  const expired = db
    .select()
    .from(knowledgeJobs)
    .where(
      and(
        lt(knowledgeJobs.leaseExpiresAt, now),
        inArray(knowledgeJobs.status, LEASED_EXECUTION_STATUSES),
      ),
    )
    .all();

  if (expired.length === 0) {
    return 0;
  }

  const ids = expired.map((j) => j.id);

  const result = db
    .update(knowledgeJobs)
    .set({
      status: 'queued',
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      updatedAt: now,
    })
    .where(
      and(
        inArray(knowledgeJobs.id, ids),
        lt(knowledgeJobs.leaseExpiresAt, now),
        inArray(knowledgeJobs.status, LEASED_EXECUTION_STATUSES),
      ),
    )
    .run();

  return result.changes;
}
