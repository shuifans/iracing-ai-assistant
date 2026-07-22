/**
 * Jobs service — orchestration layer for knowledge processing job queue.
 *
 * Wraps jobs repository (sync) with business logic: state machine guards,
 * pre-condition checks, and AppError on invalid operations.
 *
 * @module jobs/service
 */

import { AppError } from '@/lib/errors';
import {
  enqueueJob,
  enqueueJobWithInstructions,
  getJob,
  listJobs as repoListJobs,
  claimJob,
  heartbeatJob as repoHeartbeatJob,
  failJob as repoFailJob,
  completeJob as repoCompleteJob,
  retryJob,
  cancelJob,
  pauseJob,
  resumeJob,
  recoverExpiredLeases as repoRecoverExpiredLeases,
} from '@/modules/jobs/repository';
import { VALID_TRANSITIONS } from '@/modules/jobs/types';
import type { ClaimResult, JobProgress } from '@/modules/jobs/types';
import type { CursorPageResult } from '@/modules/knowledge/types';

// ---------------------------------------------------------------------------
// State machine guard — pure function, easy to test
// ---------------------------------------------------------------------------

/**
 * Check whether a status transition is allowed by the state machine.
 */
export function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS.some((t) => t.from === from && t.to === to);
}

// ---------------------------------------------------------------------------
// Submit job
// ---------------------------------------------------------------------------

/**
 * Submit a new knowledge processing job for a source.
 */
export async function submitJob(sourceId: string): Promise<{ jobId: string }> {
  const job = enqueueJob(sourceId);
  return { jobId: job.id };
}

/**
 * Submit a re-clean job carrying reviewer feedback (from the evaluation
 * feedback loop). The instructions are forwarded to the knowledge-cleaner
 * sub-agent; `parentDraftId` links the resulting draft to its predecessor.
 */
export async function submitJobWithInstructions(
  sourceId: string,
  opts: {
    instructionsJson?: string | null;
    parentDraftId?: string | null;
    kind?: 'clean' | 're_clean';
  },
): Promise<{ jobId: string }> {
  const job = enqueueJobWithInstructions(sourceId, opts);
  return { jobId: job.id };
}

// ---------------------------------------------------------------------------
// Query job status & progress
// ---------------------------------------------------------------------------

/**
 * Get current progress snapshot for a job.
 */
export async function getJobStatus(jobId: string): Promise<JobProgress> {
  const job = getJob(jobId);
  if (!job) {
    throw new AppError('NOT_FOUND', `Job ${jobId} not found`);
  }

  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

// ---------------------------------------------------------------------------
// Retry failed job
// ---------------------------------------------------------------------------

/**
 * Retry a failed job. Throws if the job is not in 'failed' state.
 */
export async function retryFailedJob(jobId: string): Promise<{ success: boolean }> {
  const job = getJob(jobId);
  if (!job) {
    throw new AppError('NOT_FOUND', `Job ${jobId} not found`);
  }

  if (job.status !== 'failed') {
    throw new AppError(
      'INVALID_STATE',
      `Cannot retry job in '${job.status}' state — must be 'failed'`,
    );
  }

  const ok = retryJob(jobId);
  return { success: ok };
}

// ---------------------------------------------------------------------------
// Cancel queued job
// ---------------------------------------------------------------------------

/**
 * Cancel a queued or paused job.
 */
export async function cancelQueuedJob(jobId: string): Promise<{ success: boolean }> {
  const job = getJob(jobId);
  if (!job) {
    throw new AppError('NOT_FOUND', `Job ${jobId} not found`);
  }

  if (job.status !== 'queued' && job.status !== 'paused') {
    throw new AppError(
      'INVALID_STATE',
      `Cannot cancel job in '${job.status}' state — must be 'queued' or 'paused'`,
    );
  }

  const ok = cancelJob(jobId);
  return { success: ok };
}

/**
 * Pause a queued job so the worker won't claim it.
 */
export async function pauseQueuedJob(jobId: string): Promise<{ success: boolean }> {
  const job = getJob(jobId);
  if (!job) {
    throw new AppError('NOT_FOUND', `Job ${jobId} not found`);
  }

  if (job.status !== 'queued') {
    throw new AppError(
      'INVALID_STATE',
      `Cannot pause job in '${job.status}' state — must be 'queued'`,
    );
  }

  const ok = pauseJob(jobId);
  return { success: ok };
}

/**
 * Resume a paused job back into the queue.
 */
export async function resumePausedJob(jobId: string): Promise<{ success: boolean }> {
  const job = getJob(jobId);
  if (!job) {
    throw new AppError('NOT_FOUND', `Job ${jobId} not found`);
  }

  if (job.status !== 'paused') {
    throw new AppError(
      'INVALID_STATE',
      `Cannot resume job in '${job.status}' state — must be 'paused'`,
    );
  }

  const ok = resumeJob(jobId);
  return { success: ok };
}

// ---------------------------------------------------------------------------
// Worker operations
// ---------------------------------------------------------------------------

/**
 * Claim the next available queued job for a worker.
 */
export async function claimNextJob(workerId: string): Promise<ClaimResult> {
  return claimJob(workerId);
}

/**
 * Extend the lease on a job (heartbeat).
 */
export async function heartbeatJob(jobId: string, workerId: string): Promise<void> {
  repoHeartbeatJob(jobId, workerId);
}

/**
 * Mark a job as failed with error details.
 */
export async function failJob(
  jobId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  repoFailJob(jobId, errorCode, errorMessage);
}

/**
 * Mark a job as complete (transitions to pending_review).
 */
export async function completeJob(jobId: string): Promise<boolean> {
  return repoCompleteJob(jobId);
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

/**
 * Recover jobs with expired leases. Returns count of recovered jobs.
 */
export async function recoverExpiredLeases(): Promise<number> {
  return repoRecoverExpiredLeases();
}

// ---------------------------------------------------------------------------
// List jobs
// ---------------------------------------------------------------------------

/**
 * List jobs with cursor-based pagination and optional filters.
 */
export async function listJobs(params: {
  limit?: number;
  cursor?: string;
  status?: string;
  sourceId?: string;
}): Promise<CursorPageResult<any>> {
  const result = repoListJobs(params);
  return { items: result.jobs, nextCursor: result.nextCursor };
}
