/**
 * Jobs repository integration tests.
 *
 * Uses createTestDb() — real in-memory SQLite + Drizzle.
 * Tests CAS lease operations, status transitions, recovery, and pagination.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { TestDb } from '../../../helpers/test-db';
import { makeUser, makeKnowledgeSource } from '../../../helpers/fixtures';
import { eq } from 'drizzle-orm';
import { users } from '@/db/schema/users';
import { knowledgeSources, knowledgeJobs } from '@/db/schema/knowledge';

// ── Skip if native module unavailable ────────────────────────────────────────
let canLoadNative = true;
try {
  const Database = require('better-sqlite3');
  const probe = new Database(':memory:');
  probe.close();
} catch {
  canLoadNative = false;
}

// ── Env stubs ──────────────────────────────────────────────────────────────
const ENV_DEFAULTS: Record<string, string> = {
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: 'test-secret-access-key-minimum-length',
  REFRESH_TOKEN_PEPPER: 'test-refresh-pepper',
  IP_HASH_PEPPER: 'test-ip-hash-pepper',
  QODER_PERSONAL_ACCESS_TOKEN: 'test-pat-token',
  KNOWLEDGE_JOB_LEASE_SECONDS: '60',
  DATABASE_PATH: ':memory:',
  WIKI_ROOT: '/tmp/wiki',
};

for (const [k, v] of Object.entries(ENV_DEFAULTS)) {
  if (!process.env[k]) process.env[k] = v;
}

// ── Shared db reference — assigned in beforeAll, read by mock factory ────────
let dbRef: TestDb | null = null;

vi.mock('@/db/client', () => ({
  getDb: () => dbRef!,
  getRawDb: () => null,
  closeDb: () => {},
  resetDbForTesting: () => {},
}));

describe.skipIf(!canLoadNative)('jobs/repository integration', () => {
  let db: TestDb;
  let cleanup: () => void;
  let userId: string;
  let sourceId: string;

  // Repository functions (lazy-loaded after mocks)
  let enqueueJob: typeof import('@/modules/jobs/repository').enqueueJob;
  let getJob: typeof import('@/modules/jobs/repository').getJob;
  let listJobs: typeof import('@/modules/jobs/repository').listJobs;
  let claimJob: typeof import('@/modules/jobs/repository').claimJob;
  let heartbeatJob: typeof import('@/modules/jobs/repository').heartbeatJob;
  let updateJobStatus: typeof import('@/modules/jobs/repository').updateJobStatus;
  let completeJob: typeof import('@/modules/jobs/repository').completeJob;
  let failJob: typeof import('@/modules/jobs/repository').failJob;
  let retryJob: typeof import('@/modules/jobs/repository').retryJob;
  let cancelJob: typeof import('@/modules/jobs/repository').cancelJob;
  let recoverExpiredLeases: typeof import('@/modules/jobs/repository').recoverExpiredLeases;

  beforeAll(async () => {
    const { createTestDb } = await import('../../../helpers/test-db');
    const result = createTestDb();
    db = result.db;
    dbRef = db;
    cleanup = result.cleanup;

    // Dynamically import the repository (after mocks are set up)
    const repo = await import('@/modules/jobs/repository');
    enqueueJob = repo.enqueueJob;
    getJob = repo.getJob;
    listJobs = repo.listJobs;
    claimJob = repo.claimJob;
    heartbeatJob = repo.heartbeatJob;
    updateJobStatus = repo.updateJobStatus;
    completeJob = repo.completeJob;
    failJob = repo.failJob;
    retryJob = repo.retryJob;
    cancelJob = repo.cancelJob;
    recoverExpiredLeases = repo.recoverExpiredLeases;

    // Seed a user and source for FK constraints
    const user = makeUser();
    userId = user.id;
    db.insert(users).values(user).run();

    const src = makeKnowledgeSource(userId, { sha256: 'jobs-test-source-sha' });
    sourceId = src.id;
    db.insert(knowledgeSources).values(src).run();
  });

  afterAll(() => {
    cleanup?.();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    db.delete(knowledgeJobs).run();
  });

  // ─── Basic CRUD ──────────────────────────────────────────────────────────

  it('enqueueJob → getJob returns correct record', () => {
    const job = enqueueJob(sourceId);
    expect(job.id).toBeTruthy();
    expect(job.status).toBe('queued');
    expect(job.attempt).toBe(0);
    expect(job.sourceId).toBe(sourceId);

    const fetched = getJob(job.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(job.id);
    expect(fetched!.status).toBe('queued');
  });

  // ─── CAS Claim ───────────────────────────────────────────────────────────

  describe('claimJob CAS', () => {
    it('successfully claims a queued job', () => {
      enqueueJob(sourceId);

      const result = claimJob('worker-1');
      expect(result.claimed).toBe(true);
      expect(result.job).not.toBeNull();
      expect(result.job!.leaseOwner).toBe('worker-1');
      expect(result.job!.status).toBe('extracting');
    });

    it('second claim of the same job fails (CAS)', () => {
      enqueueJob(sourceId);

      const first = claimJob('worker-1');
      expect(first.claimed).toBe(true);

      const second = claimJob('worker-2');
      expect(second.claimed).toBe(false);
      expect(second.job).toBeNull();
    });
  });

  // ─── Heartbeat ───────────────────────────────────────────────────────────

  it('heartbeatJob updates lease expiry and heartbeat_at', () => {
    enqueueJob(sourceId);
    const claim = claimJob('worker-1');
    expect(claim.claimed).toBe(true);

    const jobId = claim.job!.id;
    heartbeatJob(jobId, 'worker-1');

    const updated = getJob(jobId);
    expect(updated!.heartbeatAt).toBeTruthy();
    expect(updated!.leaseOwner).toBe('worker-1');
  });

  // ─── CAS Status Transitions ──────────────────────────────────────────────

  describe('updateJobStatus CAS', () => {
    it('transitions correctly when fromStatus matches', () => {
      enqueueJob(sourceId);
      const claim = claimJob('worker-1');
      const jobId = claim.job!.id;

      const ok = updateJobStatus(jobId, 'extracting', 'cleaning');
      expect(ok).toBe(true);
      expect(getJob(jobId)!.status).toBe('cleaning');
    });

    it('fails when fromStatus does not match', () => {
      enqueueJob(sourceId);
      const claim = claimJob('worker-1');
      const jobId = claim.job!.id;

      // Wrong fromStatus
      const ok = updateJobStatus(jobId, 'queued', 'cleaning');
      expect(ok).toBe(false);
      expect(getJob(jobId)!.status).toBe('extracting'); // unchanged
    });
  });

  describe('completeJob CAS', () => {
    it('atomically transitions cleaning to pending_review and clears the worker lease', () => {
      enqueueJob(sourceId);
      const claim = claimJob('worker-1');
      const jobId = claim.job!.id;

      heartbeatJob(jobId, 'worker-1');
      expect(updateJobStatus(jobId, 'extracting', 'cleaning')).toBe(true);

      const completed = completeJob(jobId);

      expect(completed).toBe(true);
      const after = getJob(jobId)!;
      expect(after.status).toBe('pending_review');
      expect(after.leaseOwner).toBeNull();
      expect(after.leaseExpiresAt).toBeNull();
      expect(after.heartbeatAt).toBeNull();
    });

    it('returns false outside cleaning and preserves status and lease metadata', () => {
      enqueueJob(sourceId);
      const claim = claimJob('worker-1');
      const jobId = claim.job!.id;
      heartbeatJob(jobId, 'worker-1');
      const before = getJob(jobId)!;

      expect(completeJob(jobId)).toBe(false);

      const after = getJob(jobId)!;
      expect(after.status).toBe('extracting');
      expect(after.leaseOwner).toBe(before.leaseOwner);
      expect(after.leaseExpiresAt).toBe(before.leaseExpiresAt);
      expect(after.heartbeatAt).toBe(before.heartbeatAt);
    });
  });

  // ─── failJob → retryJob ──────────────────────────────────────────────────

  describe('failJob → retryJob', () => {
    it('retryJob increments attempt and sets backoff', () => {
      enqueueJob(sourceId);
      const claim = claimJob('worker-1');
      const jobId = claim.job!.id;

      failJob(jobId, 'EXTRACTION_FAILED', 'parse error');
      const failed = getJob(jobId);
      expect(failed!.status).toBe('failed');
      expect(failed!.errorCode).toBe('EXTRACTION_FAILED');

      const retried = retryJob(jobId);
      expect(retried).toBe(true);

      const after = getJob(jobId);
      expect(after!.status).toBe('queued');
      expect(after!.attempt).toBe(1);
      // available_at should be in the future (backoff)
      expect(after!.availableAt).toBeTruthy();
    });

    it('retryJob returns false when job is not failed', () => {
      // Create a queued (not failed) job
      const job = enqueueJob(sourceId);
      const ok = retryJob(job.id);
      expect(ok).toBe(false);
    });
  });

  // ─── cancelJob ───────────────────────────────────────────────────────────

  it('cancelJob transitions queued → cancelled', () => {
    const job = enqueueJob(sourceId);

    const ok = cancelJob(job.id);
    expect(ok).toBe(true);

    const fetched = getJob(job.id);
    expect(fetched!.status).toBe('cancelled');
    expect(fetched!.finishedAt).toBeTruthy();
  });

  // ─── recoverExpiredLeases ────────────────────────────────────────────────

  describe('recoverExpiredLeases', () => {
    it.each(['extracting', 'cleaning'] as const)(
      'recovers jobs with expired leases while %s',
      (status) => {
        enqueueJob(sourceId);
        const claim = claimJob('worker-1');
        const jobId = claim.job!.id;

        if (status === 'cleaning') {
          expect(updateJobStatus(jobId, 'extracting', 'cleaning')).toBe(true);
        }

        // Manually set lease_expires_at to the past
        const past = new Date(Date.now() - 10000).toISOString();
        db.update(knowledgeJobs).set({ leaseExpiresAt: past }).run();

        const recovered = recoverExpiredLeases();
        expect(recovered).toBe(1);

        const after = getJob(jobId);
        expect(after!.status).toBe('queued');
        expect(after!.leaseOwner).toBeNull();
        expect(after!.leaseExpiresAt).toBeNull();
        expect(after!.heartbeatAt).toBeNull();
      },
    );

    it('does not recover pending_review jobs even when a stale lease remains', () => {
      enqueueJob(sourceId);
      const claim = claimJob('worker-1');
      const jobId = claim.job!.id;
      const past = new Date(Date.now() - 10000).toISOString();

      db.update(knowledgeJobs)
        .set({ status: 'pending_review', leaseExpiresAt: past })
        .where(eq(knowledgeJobs.id, jobId))
        .run();

      expect(recoverExpiredLeases()).toBe(0);
      expect(getJob(jobId)!.status).toBe('pending_review');
    });

    it('does not recover publishing jobs', () => {
      const job = enqueueJob(sourceId);
      const claim = claimJob('worker-1');
      const jobId = claim.job!.id;

      // Manually advance to publishing with an expired worker lease.
      const past = new Date(Date.now() - 10000).toISOString();
      db.update(knowledgeJobs)
        .set({ status: 'publishing', leaseExpiresAt: past })
        .where(eq(knowledgeJobs.id, jobId))
        .run();

      const recovered = recoverExpiredLeases();
      expect(recovered).toBe(0);
      expect(getJob(jobId)!.status).toBe('publishing');
    });

    it('retains a concurrent status advance after selecting an expired execution lease', () => {
      enqueueJob(sourceId);
      const claim = claimJob('worker-1');
      const jobId = claim.job!.id;
      const past = new Date(Date.now() - 10000).toISOString();
      db.update(knowledgeJobs)
        .set({ leaseExpiresAt: past })
        .where(eq(knowledgeJobs.id, jobId))
        .run();

      const originalUpdate = db.update.bind(db);
      let advanced = false;
      const updateSpy = vi.spyOn(db, 'update').mockImplementation(((table: any) => {
        if (table === knowledgeJobs && !advanced) {
          advanced = true;
          originalUpdate(knowledgeJobs)
            .set({ status: 'publishing' })
            .where(eq(knowledgeJobs.id, jobId))
            .run();
        }
        return originalUpdate(table);
      }) as typeof db.update);

      try {
        expect(recoverExpiredLeases()).toBe(0);
      } finally {
        updateSpy.mockRestore();
      }

      expect(getJob(jobId)!.status).toBe('publishing');
    });

    it.each(['extracting', 'cleaning'] as const)(
      'retains a concurrent lease renewal while the job remains %s',
      (status) => {
        enqueueJob(sourceId);
        const claim = claimJob('worker-1');
        const jobId = claim.job!.id;
        if (status === 'cleaning') {
          expect(updateJobStatus(jobId, 'extracting', 'cleaning')).toBe(true);
        }

        heartbeatJob(jobId, 'worker-1');
        const heartbeatAt = getJob(jobId)!.heartbeatAt;
        const past = new Date(Date.now() - 10000).toISOString();
        const renewedUntil = new Date(Date.now() + 60000).toISOString();
        db.update(knowledgeJobs)
          .set({ leaseExpiresAt: past })
          .where(eq(knowledgeJobs.id, jobId))
          .run();

        const originalUpdate = db.update.bind(db);
        let renewed = false;
        const updateSpy = vi.spyOn(db, 'update').mockImplementation(((table: any) => {
          if (table === knowledgeJobs && !renewed) {
            renewed = true;
            originalUpdate(knowledgeJobs)
              .set({ leaseExpiresAt: renewedUntil })
              .where(eq(knowledgeJobs.id, jobId))
              .run();
          }
          return originalUpdate(table);
        }) as typeof db.update);

        try {
          expect(recoverExpiredLeases()).toBe(0);
        } finally {
          updateSpy.mockRestore();
        }

        const after = getJob(jobId)!;
        expect(after.status).toBe(status);
        expect(after.leaseOwner).toBe('worker-1');
        expect(after.leaseExpiresAt).toBe(renewedUntil);
        expect(after.heartbeatAt).toBe(heartbeatAt);
      },
    );
  });

  // ─── listJobs ────────────────────────────────────────────────────────────

  describe('listJobs', () => {
    it('cursor pagination + status filter', () => {
      // Insert 5 jobs
      for (let i = 0; i < 5; i++) {
        enqueueJob(sourceId);
      }

      const all = listJobs({ limit: 10 });
      expect(all.jobs).toHaveLength(5);

      const page1 = listJobs({ limit: 3 });
      expect(page1.jobs).toHaveLength(3);
      expect(page1.nextCursor).toBeTruthy();

      const page2 = listJobs({ limit: 3, cursor: page1.nextCursor! });
      expect(page2.jobs).toHaveLength(2);
      expect(page2.nextCursor).toBeNull();

      // Status filter: cancel one job
      cancelJob(page2.jobs[0]!.id);
      const queued = listJobs({ limit: 10, status: 'queued' });
      expect(queued.jobs).toHaveLength(4);
    });
  });
});
