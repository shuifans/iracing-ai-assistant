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

// Terminal statuses — jobs in these states should not be recovered
const TERMINAL_STATUSES = ['published', 'rejected', 'cancelled'] as const;

// ---------------------------------------------------------------------------
// Basic CRUD
// ---------------------------------------------------------------------------

/**
 * Enqueue a new knowledge processing job for a source.
 */
export function enqueueJob(sourceId: string): KnowledgeJob {
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
    conditions.push(eq(knowledgeJobs.status, params.status as (typeof JOB_STATUSES)[number]));
  }
  if (params.sourceId) {
    conditions.push(eq(knowledgeJobs.sourceId, params.sourceId));
  }
  if (params.cursor) {
    conditions.push(lt(knowledgeJobs.createdAt, params.cursor));
  }

  const rows = db
    .select()
    .from(knowledgeJobs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(knowledgeJobs.createdAt))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    jobs: resultRows,
    nextCursor: hasMore ? resultRows[resultRows.length - 1]!.createdAt : null,
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
 * Mark a job as complete (pending_review).
 */
export function completeJob(id: string): void {
  const db = getDb();
  const now = utcNow();

  db.update(knowledgeJobs)
    .set({
      status: 'pending_review',
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(knowledgeJobs.id, id))
    .run();
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
 * Cancel a queued job. CAS: only succeeds if status='queued'.
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
    .where(and(eq(knowledgeJobs.id, id), eq(knowledgeJobs.status, 'queued')))
    .run();

  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

/**
 * Recover jobs with expired leases that are not in a terminal state.
 * Resets them to 'queued' with lease cleared. Returns count of recovered jobs.
 */
export function recoverExpiredLeases(): number {
  const db = getDb();
  const now = utcNow();

  // Find expired non-terminal jobs
  const expired = db
    .select()
    .from(knowledgeJobs)
    .where(
      and(
        lt(knowledgeJobs.leaseExpiresAt, now),
        inArray(knowledgeJobs.status, ['extracting', 'cleaning', 'pending_review', 'publishing']),
      ),
    )
    .all();

  if (expired.length === 0) {
    return 0;
  }

  const ids = expired.map((j) => j.id);

  db.update(knowledgeJobs)
    .set({
      status: 'queued',
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(inArray(knowledgeJobs.id, ids))
    .run();

  return expired.length;
}
