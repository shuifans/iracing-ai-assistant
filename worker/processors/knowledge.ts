/**
 * Knowledge processor — full cleaning pipeline for a single job.
 *
 * Steps:
 *  1. Get source record
 *  2. Extract text (file → extract(), URL → fetchUrl())
 *  3. Write extracted text to /data/extracted/<source-id>.txt
 *  4. CAS job extracting → cleaning
 *  5. Call createCleaningQuery() with extracted text
 *  6. Consume SDK AsyncGenerator, collect assistant text
 *  7. Parse Front Matter + Zod validation
 *  8. Word count check (>5000 → CONTENT_TOO_LARGE)
 *  9. Write draft to /data/drafts/<draft-id>.md
 * 10. CAS job cleaning → pending_review
 * 11. Create draft record in DB
 * 12. Supersede old drafts
 *
 * AbortController enforces 15-minute hard timeout and 30s idle timeout.
 *
 * @module worker/processors/knowledge
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { LeasedJob } from '@/modules/jobs/types';
import type { SDKMessage } from '@qoder-ai/qoder-agent-sdk';
import type { AgentConfig } from '@/modules/agent/types';
import * as knowledgeRepo from '@/modules/knowledge/repository';
import * as jobsRepo from '@/modules/jobs/repository';
import * as jobsService from '@/modules/jobs/service';
import { extract } from '@/modules/knowledge/extractors/index';
import { fetchUrl } from '@/modules/knowledge/extractors/url';
import {
  parseFrontMatter,
  validateFrontMatter,
  generateWikiPath,
} from '@/modules/knowledge/front-matter';
import { createCleaningQuery } from '@/modules/agent/client';
import { AppError } from '@/lib/errors';
import { generateId } from '@/lib/uuid';
import { env } from '@/config/env';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HARD_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const IDLE_TIMEOUT_MS = 30_000; // 30 seconds without SDK event
const MAX_CONTENT_CHARS = 5000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process a single knowledge cleaning job through the full pipeline.
 * All errors are caught and routed to failJob() — this function never throws.
 */
export async function processKnowledgeJob(job: LeasedJob): Promise<void> {
  const hardAbort = new AbortController();
  const hardTimer = setTimeout(() => hardAbort.abort(), HARD_TIMEOUT_MS);

  try {
    await runPipeline(job, hardAbort.signal);
  } catch (err) {
    await handleFailure(job.id, err, hardAbort.signal);
  } finally {
    clearTimeout(hardTimer);
  }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

async function runPipeline(job: LeasedJob, signal: AbortSignal): Promise<void> {
  // Step 1: Get source
  const source = knowledgeRepo.getSource(job.sourceId);
  if (!source) {
    throw new AppError(
      'EXTRACTION_FAILED',
      `Source ${job.sourceId} not found for job ${job.id}`,
    );
  }

  // Step 2: Extract text
  let extractedText: string;
  if (source.inputType === 'url' && source.sourceUrl) {
    const result = await fetchUrl(source.sourceUrl, {
      maxBytes: env.URL_FETCH_MAX_BYTES as number,
      connectTimeoutMs: 5000,
      downloadTimeoutMs: 15000,
      maxRedirects: 3,
    });
    extractedText = result.text;
  } else {
    // File-based source — read the stored file and extract
    const filePath = path.join(env.DATA_ROOT as string, source.relativePath!);
    const fileBuffer = fs.readFileSync(filePath);
    const result = await extract(fileBuffer, source.mimeType);
    extractedText = result.text;
  }

  // Step 3: Write extracted text to disk
  const extractedDir = path.join(env.DATA_ROOT as string, 'extracted');
  fs.mkdirSync(extractedDir, { recursive: true });
  const extractedPath = path.join(extractedDir, `${source.id}.txt`);
  fs.writeFileSync(extractedPath, extractedText, 'utf-8');

  // Step 4: CAS extracting → cleaning
  const casOk = jobsRepo.updateJobStatus(job.id, 'extracting', 'cleaning');
  if (!casOk) {
    throw new AppError('INVALID_STATE', 'CAS extracting→cleaning failed');
  }

  // Step 5–6: Run cleaning query via SDK
  const draftId = generateId();
  const agentConfig: AgentConfig = {
    wikiRoot: env.WIKI_ROOT as string,
    pat: env.QODER_PERSONAL_ACCESS_TOKEN as string,
    model: env.QODER_MODEL as string | undefined,
    chatTimeoutMs: env.QODER_CHAT_TIMEOUT_MS as number,
    cleanTimeoutMs: env.QODER_CLEAN_TIMEOUT_MS as number,
  };

  const cleanedMarkdown = await consumeCleaningQuery(
    agentConfig,
    extractedText,
    draftId,
    signal,
  );

  // Step 7: Parse Front Matter + Zod validation
  const parsed = parseFrontMatter(cleanedMarkdown);
  validateFrontMatter(parsed.frontMatter);

  // Step 8: Word count check
  if (cleanedMarkdown.length > MAX_CONTENT_CHARS) {
    throw new AppError(
      'CONTENT_TOO_LARGE',
      `Cleaned content is ${cleanedMarkdown.length} chars (max ${MAX_CONTENT_CHARS}). ` +
        'Please split the source into smaller parts.',
    );
  }

  // Step 9: Write draft to disk
  const draftsDir = path.join(env.DATA_ROOT as string, 'drafts');
  fs.mkdirSync(draftsDir, { recursive: true });
  const draftFileName = `${draftId}.md`;
  const draftFilePath = path.join(draftsDir, draftFileName);
  fs.writeFileSync(draftFilePath, cleanedMarkdown, 'utf-8');

  // Step 10: CAS cleaning → pending_review
  const casOk2 = jobsRepo.updateJobStatus(job.id, 'cleaning', 'pending_review');
  if (!casOk2) {
    throw new AppError('INVALID_STATE', 'CAS cleaning→pending_review failed');
  }

  // Step 11: Create draft record
  const wikiPath = generateWikiPath(parsed.frontMatter);
  const contentHash = crypto.createHash('sha256').update(cleanedMarkdown).digest('hex');

  knowledgeRepo.createDraft({
    jobId: job.id,
    suggestedPath: wikiPath,
    title: parsed.frontMatter.title,
    frontMatterJson: JSON.stringify(parsed.frontMatter),
    draftRelativePath: draftFileName,
    contentSha256: contentHash,
    status: 'pending_review',
    reviewNotes: null,
    reviewedBy: null,
    reviewedAt: null,
  });

  // Step 12: Supersede old drafts for the same source
  knowledgeRepo.supersedeOldDrafts(job.sourceId, draftId);
}

// ---------------------------------------------------------------------------
// SDK consumption with idle timeout
// ---------------------------------------------------------------------------

async function consumeCleaningQuery(
  config: AgentConfig,
  sourceText: string,
  draftId: string,
  hardSignal: AbortSignal,
): Promise<string> {
  const generator = createCleaningQuery(config, sourceText, draftId);

  let assistantText = '';
  let lastEventTime = Date.now();

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Idle timeout check
      if (Date.now() - lastEventTime > IDLE_TIMEOUT_MS) {
        throw new AppError(
          'AGENT_UNAVAILABLE',
          `No SDK event for ${IDLE_TIMEOUT_MS / 1000}s — aborting cleaning query`,
        );
      }

      // Hard timeout check
      if (hardSignal.aborted) {
        throw new AppError(
          'AGENT_UNAVAILABLE',
          'Hard timeout (15min) exceeded — aborting cleaning query',
        );
      }

      // Race the next SDK event against the idle timeout
      const { value, done } = await Promise.race([
        generator.next(),
        idleTimeoutPromise(),
        hardAbortPromise(hardSignal),
      ]);

      if (done) break;

      lastEventTime = Date.now();

      // Collect assistant text from SDK messages
      if (value) {
        const msg = value as SDKMessage;
        if (msg.type === 'assistant' && 'message' in msg) {
          const content = (msg as { message: { content: Array<{ type: string; text?: string }> } })
            .message.content;
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              assistantText += block.text;
            }
          }
        }
      }
    }
  } catch (err) {
    // If it's already an AppError, re-throw
    if (err instanceof AppError) throw err;

    // Check if it's an auth expiry or connection error
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('auth') || message.includes('expired')) {
      throw new AppError('AGENT_AUTH_EXPIRED', message);
    }

    throw new AppError('AGENT_UNAVAILABLE', `SDK query failed: ${message}`);
  }

  if (!assistantText.trim()) {
    throw new AppError(
      'AGENT_UNAVAILABLE',
      'SDK cleaning query returned no assistant text',
    );
  }

  return assistantText;
}

// ---------------------------------------------------------------------------
// Timeout promises for racing
// ---------------------------------------------------------------------------

function idleTimeoutPromise(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(
      () =>
        reject(
          new AppError(
            'AGENT_UNAVAILABLE',
            `No SDK event for ${IDLE_TIMEOUT_MS / 1000}s — aborting`,
          ),
        ),
      IDLE_TIMEOUT_MS,
    ),
  );
}

function hardAbortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new AppError('AGENT_UNAVAILABLE', 'Hard timeout exceeded'));
      return;
    }
    signal.addEventListener(
      'abort',
      () => reject(new AppError('AGENT_UNAVAILABLE', 'Hard timeout exceeded')),
      { once: true },
    );
  });
}

// ---------------------------------------------------------------------------
// Error handler — always routes to failJob, never throws
// ---------------------------------------------------------------------------

async function handleFailure(
  jobId: string,
  err: unknown,
  signal: AbortSignal,
): Promise<void> {
  let errorCode: string;
  let errorMessage: string;

  if (err instanceof AppError) {
    errorCode = err.code;
    errorMessage = err.message;
  } else if (signal.aborted) {
    errorCode = 'AGENT_UNAVAILABLE';
    errorMessage = 'Hard timeout (15min) exceeded';
  } else {
    errorCode = 'EXTRACTION_FAILED';
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  console.error(`[Worker] Job ${jobId} failed: ${errorCode} — ${errorMessage}`);

  try {
    await jobsService.failJob(jobId, errorCode, errorMessage);
  } catch (failErr) {
    console.error(`[Worker] Failed to mark job ${jobId} as failed:`, failErr);
  }
}
