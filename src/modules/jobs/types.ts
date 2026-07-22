/**
 * Jobs module types — knowledge processing job queue, worker config, and status transitions.
 *
 * @module jobs/types
 */

import type { JobStatus } from '@/config/constants';

// Re-export JobStatus for consumers that prefer importing from the jobs module
export type { JobStatus };

// ---------------------------------------------------------------------------
// QueuedJob — job view when status is 'queued'
// ---------------------------------------------------------------------------

export interface QueuedJob {
  id: string;
  sourceId: string;
  status: 'queued';
  attempt: number;
  maxAttempts: number;
  availableAt: string;
  createdAt: string;
  /** Reviewer feedback forwarded to the knowledge-cleaner (re-clean jobs). */
  instructionsJson?: string | null;
  /** Predecessor draft for version history (re-clean jobs). */
  parentDraftId?: string | null;
  /** 'clean' for initial cleaning, 're_clean' for feedback-driven re-cleaning. */
  jobKind?: 'clean' | 're_clean';
}

// ---------------------------------------------------------------------------
// LeasedJob — job currently held by a worker
// ---------------------------------------------------------------------------

export interface LeasedJob {
  id: string;
  sourceId: string;
  status: string; // extracting | cleaning | publishing
  leaseOwner: string;
  leaseExpiresAt: string;
  attempt: number;
  /** Reviewer feedback forwarded to the knowledge-cleaner (re-clean jobs). */
  instructionsJson?: string | null;
  /** Predecessor draft for version history (re-clean jobs). */
  parentDraftId?: string | null;
  /** 'clean' for initial cleaning, 're_clean' for feedback-driven re-cleaning. */
  jobKind?: 'clean' | 're_clean';
}

// ---------------------------------------------------------------------------
// JobProgress — progress snapshot for a job
// ---------------------------------------------------------------------------

export interface JobProgress {
  jobId: string;
  status: string;
  progress: number; // 0-100
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

// ---------------------------------------------------------------------------
// WorkerConfig — runtime configuration for the job worker
// ---------------------------------------------------------------------------

export interface WorkerConfig {
  concurrency: number;
  leaseSeconds: number;
  pollIntervalMs: number;
  gracefulShutdownMs: number;
}

// ---------------------------------------------------------------------------
// StatusTransition — allowed from→to state changes
// ---------------------------------------------------------------------------

export interface StatusTransition {
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// ClaimResult — result of attempting to claim a job from the queue
// ---------------------------------------------------------------------------

export interface ClaimResult {
  claimed: boolean;
  job: LeasedJob | null;
}

// ---------------------------------------------------------------------------
// Valid state transitions — runtime constant used by the job service
// ---------------------------------------------------------------------------

export const VALID_TRANSITIONS: readonly StatusTransition[] = [
  { from: 'queued', to: 'extracting' },
  { from: 'queued', to: 'paused' },
  { from: 'paused', to: 'queued' },
  { from: 'paused', to: 'cancelled' },
  { from: 'extracting', to: 'cleaning' },
  { from: 'extracting', to: 'failed' },
  { from: 'cleaning', to: 'pending_review' },
  { from: 'cleaning', to: 'failed' },
  { from: 'pending_review', to: 'approved' },
  { from: 'pending_review', to: 'rejected' },
  { from: 'approved', to: 'pending_review' }, // unapprove
  { from: 'approved', to: 'publishing' },
  { from: 'publishing', to: 'published' },
  { from: 'publishing', to: 'failed' },
  { from: 'failed', to: 'queued' }, // retry
  { from: 'queued', to: 'cancelled' },
] as const;
