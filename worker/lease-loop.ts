/**
 * Lease Loop — Worker core polling loop with heartbeat and graceful shutdown.
 *
 * Each tick:
 * 1. Attempt to claim a job from the queue
 * 2. If claimed → start heartbeat → process → complete
 * 3. If no job → wait pollIntervalMs
 * 4. Every 5 ticks → call recoverExpiredLeases
 *
 * @module worker/lease-loop
 */

import type { WorkerConfig, ClaimResult } from '@/modules/jobs/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LeaseLoopDeps {
  config: WorkerConfig;
  claimNextJob: (workerId: string) => Promise<ClaimResult>;
  heartbeatJob: (jobId: string, workerId: string) => Promise<void>;
  recoverExpiredLeases: () => Promise<number>;
  processJob: (job: ClaimResult['job']) => Promise<void>;
}

// ---------------------------------------------------------------------------
// LeaseLoop
// ---------------------------------------------------------------------------

export class LeaseLoop {
  private running = false;
  private currentJob: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  private processingDone: Promise<void> | null = null;

  constructor(private deps: LeaseLoopDeps) {}

  /**
   * Start the lease loop. Blocks until stop() is called and the current job finishes.
   */
  async start(workerId: string): Promise<void> {
    this.running = true;
    this.tickCount = 0;

    while (this.running) {
      await this.tick(workerId);

      if (!this.running) break;

      // Wait for pollIntervalMs before next tick
      await sleep(this.deps.config.pollIntervalMs);
    }
  }

  /**
   * Gracefully stop the loop. Sets running=false and waits for the current job
   * to finish (up to gracefulShutdownMs).
   */
  async stop(): Promise<void> {
    this.running = false;

    // Wait for the current processing to complete
    if (this.processingDone) {
      const timeout = new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error('Graceful shutdown timeout')),
          this.deps.config.gracefulShutdownMs,
        ),
      );
      try {
        await Promise.race([this.processingDone, timeout]);
      } catch {
        console.warn('[LeaseLoop] Graceful shutdown timeout — forcing exit');
      }
    }

    this.stopHeartbeat();
  }

  /**
   * Single tick: recover (every 5th) → claim → process → release.
   */
  private async tick(workerId: string): Promise<void> {
    this.tickCount++;

    // Recover expired leases every 5 ticks
    if (this.tickCount % 5 === 0) {
      try {
        const recovered = await this.deps.recoverExpiredLeases();
        if (recovered > 0) {
          console.log(`[LeaseLoop] Recovered ${recovered} expired lease(s)`);
        }
      } catch (err) {
        console.error('[LeaseLoop] recoverExpiredLeases failed:', err);
      }
    }

    // Attempt to claim a job
    let claimResult: ClaimResult;
    try {
      claimResult = await this.deps.claimNextJob(workerId);
    } catch (err) {
      console.error('[LeaseLoop] claimNextJob failed:', err);
      return;
    }

    if (!claimResult.claimed || !claimResult.job) {
      return; // No job available
    }

    const job = claimResult.job;
    this.currentJob = job.id;

    // Start heartbeat
    this.startHeartbeat(job.id, workerId);

    // Process the job
    const processingPromise = (async () => {
      try {
        await this.deps.processJob(job);
      } catch (err) {
        console.error(`[LeaseLoop] processJob failed for ${job.id}:`, err);
      } finally {
        this.stopHeartbeat();
        this.currentJob = null;
        this.processingDone = null;
      }
    })();

    this.processingDone = processingPromise;
    await processingPromise;
  }

  /**
   * Start heartbeat timer — fires every 30 seconds.
   */
  private startHeartbeat(jobId: string, workerId: string): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.deps.heartbeatJob(jobId, workerId);
      } catch (err) {
        console.error(`[LeaseLoop] Heartbeat failed for ${jobId}:`, err);
      }
    }, 30_000);
  }

  /**
   * Stop the heartbeat timer.
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
