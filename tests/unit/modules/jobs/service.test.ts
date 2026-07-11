import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing service
vi.mock('@/modules/jobs/repository', () => ({
  enqueueJob: vi.fn(),
  getJob: vi.fn(),
  listJobs: vi.fn(),
  claimJob: vi.fn(),
  heartbeatJob: vi.fn(),
  failJob: vi.fn(),
  completeJob: vi.fn(),
  retryJob: vi.fn(),
  cancelJob: vi.fn(),
  recoverExpiredLeases: vi.fn(),
}));

// Import after mocks
import {
  enqueueJob,
  getJob,
  listJobs as repoListJobs,
  claimJob,
  heartbeatJob as repoHeartbeatJob,
  failJob as repoFailJob,
  completeJob as repoCompleteJob,
  retryJob,
  cancelJob,
  recoverExpiredLeases as repoRecoverExpiredLeases,
} from '@/modules/jobs/repository';

import {
  canTransition,
  submitJob,
  getJobStatus,
  retryFailedJob,
  cancelQueuedJob,
  claimNextJob,
  heartbeatJob,
  failJob,
  completeJob,
  recoverExpiredLeases,
  listJobs,
} from '@/modules/jobs/service';

import { AppError } from '@/lib/errors';

const mockEnqueueJob = vi.mocked(enqueueJob);
const mockGetJob = vi.mocked(getJob);
const mockRepoListJobs = vi.mocked(repoListJobs);
const mockClaimJob = vi.mocked(claimJob);
const mockRepoHeartbeatJob = vi.mocked(repoHeartbeatJob);
const mockRepoFailJob = vi.mocked(repoFailJob);
const mockRepoCompleteJob = vi.mocked(repoCompleteJob);
const mockRetryJob = vi.mocked(retryJob);
const mockCancelJob = vi.mocked(cancelJob);
const mockRepoRecoverExpiredLeases = vi.mocked(repoRecoverExpiredLeases);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockJob(overrides: Record<string, any> = {}) {
  return {
    id: 'job-001',
    sourceId: 'source-001',
    status: 'queued' as const,
    attempt: 0,
    maxAttempts: 3,
    availableAt: '2026-07-12T00:00:00.000Z',
    leaseOwner: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    progress: 0,
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('jobs/service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── canTransition ────────────────────────────────────────────────────────

  describe('canTransition', () => {
    it('queued → extracting: true', () => {
      expect(canTransition('queued', 'extracting')).toBe(true);
    });

    it('extracting → cleaning: true', () => {
      expect(canTransition('extracting', 'cleaning')).toBe(true);
    });

    it('cleaning → pending_review: true', () => {
      expect(canTransition('cleaning', 'pending_review')).toBe(true);
    });

    it('pending_review → publishing: true', () => {
      expect(canTransition('pending_review', 'publishing')).toBe(true);
    });

    it('publishing → published: true', () => {
      expect(canTransition('publishing', 'published')).toBe(true);
    });

    it('queued → cancelled: true', () => {
      expect(canTransition('queued', 'cancelled')).toBe(true);
    });

    it('published → queued: false (illegal)', () => {
      expect(canTransition('published', 'queued')).toBe(false);
    });

    it('cancelled → queued: false (terminal state)', () => {
      expect(canTransition('cancelled', 'queued')).toBe(false);
    });
  });

  // ─── submitJob ─────────────────────────────────────────────────────────────

  describe('submitJob', () => {
    it('calls repository.enqueueJob and returns jobId', async () => {
      const mockJob = makeMockJob({ id: 'new-job-001' });
      mockEnqueueJob.mockReturnValue(mockJob);

      const result = await submitJob('source-001');

      expect(mockEnqueueJob).toHaveBeenCalledWith('source-001');
      expect(result).toEqual({ jobId: 'new-job-001' });
    });
  });

  // ─── getJobStatus ──────────────────────────────────────────────────────────

  describe('getJobStatus', () => {
    it('returns JobProgress for an existing job', async () => {
      const mockJob = makeMockJob({
        status: 'extracting',
        progress: 42,
        startedAt: '2026-07-12T00:00:00.000Z',
      });
      mockGetJob.mockReturnValue(mockJob);

      const result = await getJobStatus('job-001');

      expect(mockGetJob).toHaveBeenCalledWith('job-001');
      expect(result).toEqual({
        jobId: 'job-001',
        status: 'extracting',
        progress: 42,
        errorCode: null,
        errorMessage: null,
        startedAt: '2026-07-12T00:00:00.000Z',
        finishedAt: null,
      });
    });

    it('throws NOT_FOUND when job does not exist', async () => {
      mockGetJob.mockReturnValue(null);

      await expect(getJobStatus('nonexistent')).rejects.toThrow(AppError);
      await expect(getJobStatus('nonexistent')).rejects.toThrow('not found');
    });
  });

  // ─── retryFailedJob ────────────────────────────────────────────────────────

  describe('retryFailedJob', () => {
    it('retries a failed job successfully', async () => {
      mockGetJob.mockReturnValue(makeMockJob({ status: 'failed' }));
      mockRetryJob.mockReturnValue(true);

      const result = await retryFailedJob('job-001');

      expect(mockRetryJob).toHaveBeenCalledWith('job-001');
      expect(result).toEqual({ success: true });
    });

    it('throws INVALID_STATE for non-failed job', async () => {
      mockGetJob.mockReturnValue(makeMockJob({ status: 'extracting' }));

      await expect(retryFailedJob('job-001')).rejects.toThrow(AppError);
      await expect(retryFailedJob('job-001')).rejects.toThrow(/must be 'failed'/);
      expect(mockRetryJob).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND when job does not exist', async () => {
      mockGetJob.mockReturnValue(null);

      await expect(retryFailedJob('nonexistent')).rejects.toThrow(AppError);
      expect(mockRetryJob).not.toHaveBeenCalled();
    });
  });

  // ─── cancelQueuedJob ───────────────────────────────────────────────────────

  describe('cancelQueuedJob', () => {
    it('cancels a queued job successfully', async () => {
      mockGetJob.mockReturnValue(makeMockJob({ status: 'queued' }));
      mockCancelJob.mockReturnValue(true);

      const result = await cancelQueuedJob('job-001');

      expect(mockCancelJob).toHaveBeenCalledWith('job-001');
      expect(result).toEqual({ success: true });
    });

    it('throws INVALID_STATE for non-queued job', async () => {
      mockGetJob.mockReturnValue(makeMockJob({ status: 'extracting' }));

      await expect(cancelQueuedJob('job-001')).rejects.toThrow(AppError);
      await expect(cancelQueuedJob('job-001')).rejects.toThrow(/must be 'queued'/);
      expect(mockCancelJob).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND when job does not exist', async () => {
      mockGetJob.mockReturnValue(null);

      await expect(cancelQueuedJob('nonexistent')).rejects.toThrow(AppError);
      expect(mockCancelJob).not.toHaveBeenCalled();
    });
  });

  // ─── claimNextJob ──────────────────────────────────────────────────────────

  describe('claimNextJob', () => {
    it('delegates to repository.claimJob', async () => {
      const claimResult = {
        claimed: true,
        job: {
          id: 'job-001',
          sourceId: 'source-001',
          status: 'extracting',
          leaseOwner: 'worker-1',
          leaseExpiresAt: '2026-07-12T00:05:00.000Z',
          attempt: 0,
        },
      };
      mockClaimJob.mockReturnValue(claimResult);

      const result = await claimNextJob('worker-1');

      expect(mockClaimJob).toHaveBeenCalledWith('worker-1');
      expect(result).toEqual(claimResult);
    });

    it('returns claimed=false when no jobs available', async () => {
      mockClaimJob.mockReturnValue({ claimed: false, job: null });

      const result = await claimNextJob('worker-1');

      expect(result.claimed).toBe(false);
      expect(result.job).toBeNull();
    });
  });

  // ─── heartbeatJob ──────────────────────────────────────────────────────────

  describe('heartbeatJob', () => {
    it('delegates to repository.heartbeatJob', async () => {
      await heartbeatJob('job-001', 'worker-1');

      expect(mockRepoHeartbeatJob).toHaveBeenCalledWith('job-001', 'worker-1');
    });
  });

  // ─── failJob ───────────────────────────────────────────────────────────────

  describe('failJob', () => {
    it('delegates to repository.failJob', async () => {
      await failJob('job-001', 'EXTRACTION_FAILED', 'PDF parsing error');

      expect(mockRepoFailJob).toHaveBeenCalledWith(
        'job-001',
        'EXTRACTION_FAILED',
        'PDF parsing error',
      );
    });
  });

  // ─── completeJob ───────────────────────────────────────────────────────────

  describe('completeJob', () => {
    it('delegates to repository.completeJob', async () => {
      await completeJob('job-001');

      expect(mockRepoCompleteJob).toHaveBeenCalledWith('job-001');
    });
  });

  // ─── recoverExpiredLeases ──────────────────────────────────────────────────

  describe('recoverExpiredLeases', () => {
    it('delegates to repository.recoverExpiredLeases and returns count', async () => {
      mockRepoRecoverExpiredLeases.mockReturnValue(3);

      const count = await recoverExpiredLeases();

      expect(mockRepoRecoverExpiredLeases).toHaveBeenCalled();
      expect(count).toBe(3);
    });

    it('returns 0 when no expired leases', async () => {
      mockRepoRecoverExpiredLeases.mockReturnValue(0);

      const count = await recoverExpiredLeases();

      expect(count).toBe(0);
    });
  });

  // ─── listJobs ──────────────────────────────────────────────────────────────

  describe('listJobs', () => {
    it('returns CursorPageResult mapped from repository result', async () => {
      const mockJobs = [
        makeMockJob({ id: 'job-001' }),
        makeMockJob({ id: 'job-002' }),
      ];
      mockRepoListJobs.mockReturnValue({ jobs: mockJobs, nextCursor: 'cursor-abc' });

      const result = await listJobs({ limit: 10, status: 'queued' });

      expect(mockRepoListJobs).toHaveBeenCalledWith({ limit: 10, status: 'queued' });
      expect(result).toEqual({ items: mockJobs, nextCursor: 'cursor-abc' });
    });

    it('returns null nextCursor when no more pages', async () => {
      mockRepoListJobs.mockReturnValue({ jobs: [], nextCursor: null });

      const result = await listJobs({});

      expect(result.items).toEqual([]);
      expect(result.nextCursor).toBeNull();
    });
  });
});
