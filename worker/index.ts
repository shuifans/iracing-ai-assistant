/**
 * Worker process entry point — starts the lease loop for knowledge cleaning jobs.
 *
 * This is a standalone Node.js process, separate from the Next.js web server.
 * It polls the job queue, claims jobs, and processes them through the
 * knowledge cleaning pipeline.
 *
 * @module worker/index
 */

import { LeaseLoop } from './lease-loop';
import { processKnowledgeJob } from './processors/knowledge';
import { env } from '@/config/env';
import * as jobsService from '@/modules/jobs/service';
import type { WorkerConfig, ClaimResult } from '@/modules/jobs/types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const config: WorkerConfig = {
  concurrency: env.KNOWLEDGE_WORKER_CONCURRENCY as number,
  leaseSeconds: env.KNOWLEDGE_JOB_LEASE_SECONDS as number,
  pollIntervalMs: 5000,
  gracefulShutdownMs: 30000,
};

// ---------------------------------------------------------------------------
// Worker ID
// ---------------------------------------------------------------------------

const workerId = `worker-${process.pid}-${Date.now()}`;

// ---------------------------------------------------------------------------
// Create lease loop with real dependencies
// ---------------------------------------------------------------------------

const loop = new LeaseLoop({
  config,
  claimNextJob: (wid: string) => jobsService.claimNextJob(wid),
  heartbeatJob: (jobId: string, wid: string) => jobsService.heartbeatJob(jobId, wid),
  recoverExpiredLeases: () => jobsService.recoverExpiredLeases(),
  processJob: async (job: ClaimResult['job']) => {
    if (!job) return;
    await processKnowledgeJob(job);
  },
});

// ---------------------------------------------------------------------------
// Signal handling — graceful shutdown
// ---------------------------------------------------------------------------

process.on('SIGTERM', async () => {
  console.log('[Worker] SIGTERM received — shutting down gracefully');
  await loop.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Worker] SIGINT received — shutting down gracefully');
  await loop.stop();
  process.exit(0);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

console.log(
  `[Worker] Starting with id=${workerId}, concurrency=${config.concurrency}, ` +
    `leaseSeconds=${config.leaseSeconds}, pollIntervalMs=${config.pollIntervalMs}`,
);

loop.start(workerId).catch((err) => {
  console.error('[Worker] Fatal error in lease loop:', err);
  process.exit(1);
});
