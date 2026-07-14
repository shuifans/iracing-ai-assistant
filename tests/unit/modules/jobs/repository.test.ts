import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB client and dependencies before importing repository
vi.mock('@/db/client', () => ({
  getDb: vi.fn(),
}));

vi.mock('@/lib/uuid', () => ({
  generateId: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).slice(2, 8)),
}));

vi.mock('@/lib/datetime', () => ({
  utcNow: vi.fn(() => '2026-07-12T00:00:00.000Z'),
}));

vi.mock('@/config/env', () => ({
  env: { KNOWLEDGE_JOB_LEASE_SECONDS: 300 },
}));

// Create mock DB with chainable methods
const mockRun = vi.fn();
const mockAll = vi.fn();
const mockLimit = vi.fn();
const mockOrderBy = vi.fn();
const mockWhere = vi.fn();
const mockSet = vi.fn();
const mockValues = vi.fn();
const mockFrom = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();

function setupMockDb() {
  // Chain: select().from().where().limit() / .orderBy()
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ limit: mockLimit, orderBy: mockOrderBy, all: mockAll, run: mockRun });
  mockLimit.mockReturnValue({ all: mockAll, run: mockRun });
  mockAll.mockReturnValue([]);
  mockOrderBy.mockReturnValue({ limit: mockLimit, all: mockAll });

  // Chain: insert().values().run()
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ run: mockRun });

  // Chain: update().set().where().run()
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockWhere, run: mockRun });

  vi.mocked(getDb).mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  } as any);
}

// Import after mocks
import { getDb } from '@/db/client';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('jobs/repository', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setupMockDb();
  });

  // ─── enqueueJob ────────────────────────────────────────────────────────────

  describe('enqueueJob', () => {
    it('inserts a job with correct defaults', async () => {
      const { enqueueJob } = await import('@/modules/jobs/repository');
      const job = enqueueJob('source-001');

      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalled();
      expect(job.sourceId).toBe('source-001');
      expect(job.status).toBe('queued');
      expect(job.attempt).toBe(0);
      expect(job.maxAttempts).toBe(3);
      expect(job.availableAt).toBe('2026-07-12T00:00:00.000Z');
      expect(job.leaseOwner).toBeNull();
      expect(job.leaseExpiresAt).toBeNull();
      expect(job.progress).toBe(0);
      expect(job.errorCode).toBeNull();
      expect(job.errorMessage).toBeNull();
      expect(job.startedAt).toBeNull();
      expect(job.finishedAt).toBeNull();
      // Plain cleaning job: feedback/version fields default
      expect(job.instructionsJson).toBeNull();
      expect(job.parentDraftId).toBeNull();
      expect(job.jobKind).toBe('clean');
    });
  });

  // ─── enqueueJobWithInstructions ───────────────────────────────────────────

  describe('enqueueJobWithInstructions', () => {
    it('inserts a re-clean job carrying feedback + parent + kind', async () => {
      const { enqueueJobWithInstructions } = await import('@/modules/jobs/repository');
      const job = enqueueJobWithInstructions('source-001', {
        instructionsJson: '{"improvementInstructions":{"add":"examples"}}',
        parentDraftId: 'draft-001',
        kind: 're_clean',
      });

      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalled();
      expect(job.sourceId).toBe('source-001');
      expect(job.status).toBe('queued');
      expect(job.instructionsJson).toBe('{"improvementInstructions":{"add":"examples"}}');
      expect(job.parentDraftId).toBe('draft-001');
      expect(job.jobKind).toBe('re_clean');

      // The inserted record carries the feedback payload
      const inserted = mockValues.mock.calls[0]![0];
      expect(inserted.instructionsJson).toBe('{"improvementInstructions":{"add":"examples"}}');
      expect(inserted.parentDraftId).toBe('draft-001');
      expect(inserted.jobKind).toBe('re_clean');
    });

    it('defaults kind to clean and nulls when opts empty', async () => {
      const { enqueueJobWithInstructions } = await import('@/modules/jobs/repository');
      const job = enqueueJobWithInstructions('source-001', {});

      expect(job.instructionsJson).toBeNull();
      expect(job.parentDraftId).toBeNull();
      expect(job.jobKind).toBe('clean');
    });
  });

  // ─── getJob ────────────────────────────────────────────────────────────────

  describe('getJob', () => {
    it('returns job when found', async () => {
      const mockJob = { id: 'job-001', sourceId: 'src-1', status: 'queued' };
      mockAll.mockReturnValue([mockJob]);

      const { getJob } = await import('@/modules/jobs/repository');
      const result = getJob('job-001');

      expect(result).toEqual(mockJob);
    });

    it('returns null when not found', async () => {
      mockAll.mockReturnValue([]);

      const { getJob } = await import('@/modules/jobs/repository');
      const result = getJob('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ─── listJobs ──────────────────────────────────────────────────────────────

  describe('listJobs', () => {
    it('returns jobs with pagination', async () => {
      const jobs = Array.from({ length: 11 }, (_, i) => ({
        id: `job-${i}`,
        sourceId: 'src-1',
        status: 'queued',
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
      }));
      mockAll.mockReturnValue(jobs);

      const { listJobs } = await import('@/modules/jobs/repository');
      const result = listJobs({ limit: 10 });

      expect(result.jobs.length).toBe(10);
      expect(result.nextCursor).toBeTruthy();
    });

    it('returns null nextCursor when no more pages', async () => {
      const jobs = Array.from({ length: 3 }, (_, i) => ({
        id: `job-${i}`,
        sourceId: 'src-1',
        status: 'queued',
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
      }));
      mockAll.mockReturnValue(jobs);

      const { listJobs } = await import('@/modules/jobs/repository');
      const result = listJobs({ limit: 10 });

      expect(result.jobs.length).toBe(3);
      expect(result.nextCursor).toBeNull();
    });
  });

  // ─── claimJob ──────────────────────────────────────────────────────────────

  describe('claimJob', () => {
    it('claims an available job and returns LeasedJob', async () => {
      const candidateJob = {
        id: 'job-001',
        sourceId: 'src-1',
        status: 'queued',
        attempt: 0,
        createdAt: '2026-07-12T00:00:00.000Z',
      };
      mockAll.mockReturnValue([candidateJob]);
      mockRun.mockReturnValue({ changes: 1 });

      const { claimJob } = await import('@/modules/jobs/repository');
      const result = claimJob('worker-1');

      expect(result.claimed).toBe(true);
      expect(result.job).not.toBeNull();
      expect(result.job!.id).toBe('job-001');
      expect(result.job!.sourceId).toBe('src-1');
      expect(result.job!.status).toBe('extracting');
      expect(result.job!.leaseOwner).toBe('worker-1');
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('returns claimed=false when no available jobs', async () => {
      mockAll.mockReturnValue([]);

      const { claimJob } = await import('@/modules/jobs/repository');
      const result = claimJob('worker-1');

      expect(result.claimed).toBe(false);
      expect(result.job).toBeNull();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('returns claimed=false when CAS update fails (race condition)', async () => {
      const candidateJob = {
        id: 'job-001',
        sourceId: 'src-1',
        status: 'queued',
        attempt: 0,
      };
      mockAll.mockReturnValue([candidateJob]);
      mockRun.mockReturnValue({ changes: 0 });

      const { claimJob } = await import('@/modules/jobs/repository');
      const result = claimJob('worker-1');

      expect(result.claimed).toBe(false);
      expect(result.job).toBeNull();
    });
  });

  // ─── heartbeatJob ──────────────────────────────────────────────────────────

  describe('heartbeatJob', () => {
    it('updates lease_expires_at and heartbeat_at', async () => {
      const { heartbeatJob } = await import('@/modules/jobs/repository');
      heartbeatJob('job-001', 'worker-1');

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalled();
      const setArg = mockSet.mock.calls[0]![0];
      expect(setArg.leaseExpiresAt).toBeDefined();
      expect(setArg.heartbeatAt).toBe('2026-07-12T00:00:00.000Z');
      expect(mockRun).toHaveBeenCalled();
    });
  });

  // ─── releaseJob ────────────────────────────────────────────────────────────

  describe('releaseJob', () => {
    it('clears lease_owner and lease_expires_at', async () => {
      const { releaseJob } = await import('@/modules/jobs/repository');
      releaseJob('job-001');

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          leaseOwner: null,
          leaseExpiresAt: null,
        }),
      );
      expect(mockRun).toHaveBeenCalled();
    });
  });

  // ─── updateJobStatus ───────────────────────────────────────────────────────

  describe('updateJobStatus', () => {
    it('returns true when fromStatus matches', async () => {
      mockRun.mockReturnValue({ changes: 1 });

      const { updateJobStatus } = await import('@/modules/jobs/repository');
      const result = updateJobStatus('job-001', 'queued', 'extracting');

      expect(result).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('returns false when fromStatus does not match', async () => {
      mockRun.mockReturnValue({ changes: 0 });

      const { updateJobStatus } = await import('@/modules/jobs/repository');
      const result = updateJobStatus('job-001', 'queued', 'extracting');

      expect(result).toBe(false);
    });
  });

  // ─── failJob ───────────────────────────────────────────────────────────────

  describe('failJob', () => {
    it('sets status to failed with error details and finished_at', async () => {
      const { failJob } = await import('@/modules/jobs/repository');
      failJob('job-001', 'EXTRACTION_FAILED', 'PDF parsing error');

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          errorCode: 'EXTRACTION_FAILED',
          errorMessage: 'PDF parsing error',
          finishedAt: '2026-07-12T00:00:00.000Z',
        }),
      );
      expect(mockRun).toHaveBeenCalled();
    });
  });

  // ─── completeJob ───────────────────────────────────────────────────────────

  describe('completeJob', () => {
    it('sets status to pending_review with finished_at', async () => {
      const { completeJob } = await import('@/modules/jobs/repository');
      completeJob('job-001');

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending_review',
          finishedAt: '2026-07-12T00:00:00.000Z',
        }),
      );
      expect(mockRun).toHaveBeenCalled();
    });
  });

  // ─── retryJob ──────────────────────────────────────────────────────────────

  describe('retryJob', () => {
    it('retries a failed job with attempt+1 and backoff delay', async () => {
      const failedJob = { id: 'job-001', status: 'failed', attempt: 1 };
      mockAll.mockReturnValue([failedJob]);
      mockRun.mockReturnValue({ changes: 1 });

      const { retryJob } = await import('@/modules/jobs/repository');
      const result = retryJob('job-001');

      expect(result).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
      const setArg = mockSet.mock.calls[0]![0];
      expect(setArg.status).toBe('queued');
      expect(setArg.attempt).toBe(2);
      expect(setArg.errorCode).toBeNull();
      expect(setArg.errorMessage).toBeNull();
      // Backoff: attempt 2 * 60 = 120 seconds from utcNow
      expect(setArg.availableAt).toBeDefined();
      expect(new Date(setArg.availableAt).getTime()).toBeGreaterThan(
        new Date('2026-07-12T00:00:00.000Z').getTime(),
      );
    });

    it('returns false for non-failed job', async () => {
      mockAll.mockReturnValue([{ id: 'job-001', status: 'extracting', attempt: 0 }]);

      const { retryJob } = await import('@/modules/jobs/repository');
      const result = retryJob('job-001');

      expect(result).toBe(false);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('returns false when job not found', async () => {
      mockAll.mockReturnValue([]);

      const { retryJob } = await import('@/modules/jobs/repository');
      const result = retryJob('nonexistent');

      expect(result).toBe(false);
    });
  });

  // ─── cancelJob ─────────────────────────────────────────────────────────────

  describe('cancelJob', () => {
    it('cancels a queued job', async () => {
      mockRun.mockReturnValue({ changes: 1 });

      const { cancelJob } = await import('@/modules/jobs/repository');
      const result = cancelJob('job-001');

      expect(result).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'cancelled',
          finishedAt: '2026-07-12T00:00:00.000Z',
        }),
      );
    });

    it('returns false for non-queued job', async () => {
      mockRun.mockReturnValue({ changes: 0 });

      const { cancelJob } = await import('@/modules/jobs/repository');
      const result = cancelJob('job-001');

      expect(result).toBe(false);
    });
  });

  // ─── recoverExpiredLeases ──────────────────────────────────────────────────

  describe('recoverExpiredLeases', () => {
    it('resets expired leases and returns count', async () => {
      const expiredJobs = [
        { id: 'job-001', status: 'extracting', leaseExpiresAt: '2026-07-11T23:55:00.000Z' },
        { id: 'job-002', status: 'cleaning', leaseExpiresAt: '2026-07-11T23:50:00.000Z' },
      ];
      mockAll.mockReturnValue(expiredJobs);
      mockRun.mockReturnValue({ changes: 2 });

      const { recoverExpiredLeases } = await import('@/modules/jobs/repository');
      const count = recoverExpiredLeases();

      expect(count).toBe(2);
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'queued',
          leaseOwner: null,
          leaseExpiresAt: null,
        }),
      );
    });

    it('returns 0 when no expired leases', async () => {
      mockAll.mockReturnValue([]);

      const { recoverExpiredLeases } = await import('@/modules/jobs/repository');
      const count = recoverExpiredLeases();

      expect(count).toBe(0);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
