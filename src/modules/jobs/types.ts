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
  { from: 'extracting', to: 'cleaning' },
  { from: 'extracting', to: 'failed' },
  { from: 'cleaning', to: 'pending_review' },
  { from: 'cleaning', to: 'failed' },
  { from: 'pending_review', to: 'publishing' },
  { from: 'pending_review', to: 'rejected' },
  { from: 'publishing', to: 'published' },
  { from: 'publishing', to: 'failed' },
  { from: 'failed', to: 'queued' }, // retry
  { from: 'queued', to: 'cancelled' },
] as const;
