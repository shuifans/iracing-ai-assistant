/**
 * Knowledge processor — full cleaning pipeline for a single job.
 *
 * Steps:
 *  1. Get source record
 *  2. Extract text (file → extract(), URL → fetchUrl())
 *  3. Write extracted text to /data/extracted/<source-id>.txt
 *  4. CAS job extracting → cleaning
 *  5. Call the OpenAI-compatible LLM cleaner with extracted text
 *  6. Collect the cleaned Markdown response
 *  7. Parse Front Matter + Zod validation
 *  8. Word count check (>5000 → CONTENT_TOO_LARGE)
 *  9. Write draft to /data/drafts/<draft-id>.md
 * 10. CAS job cleaning → pending_review
 * 11. Create draft record in DB (versioned for re-clean lineage)
 * 12. Supersede old drafts
 * 13. Auto-evaluate draft (heuristic + probe) — non-fatal
 *
 * AbortController enforces 30-minute hard timeout and 30s idle timeout.
 *
 * @module worker/processors/knowledge
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { LeasedJob } from '@/modules/jobs/types';
import * as knowledgeRepo from '@/modules/knowledge/repository';
import * as jobsRepo from '@/modules/jobs/repository';
import * as jobsService from '@/modules/jobs/service';
import { extract } from '@/modules/knowledge/extractors/index';
import { getSourceSnapshotPath, writeSourceSnapshot } from '@/modules/knowledge/source-snapshot';
import {
  parseFrontMatter,
  validateFrontMatter,
  assertTrustedSourceMetadata,
  generateWikiPath,
} from '@/modules/knowledge/front-matter';
import { CleaningInputTooLargeError, cleanWithLlmDirect } from '@/modules/knowledge/llm-cleaner';
import { evaluateDraft } from '@/modules/knowledge-evaluation/service';
import { AppError } from '@/lib/errors';
import { generateId } from '@/lib/uuid';
import { env } from '@/config/env';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HARD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes (multimodal/vision cleaning can be slow)
const MAX_CONTENT_CHARS = 12_000;

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
    throw new AppError('EXTRACTION_FAILED', `Source ${job.sourceId} not found for job ${job.id}`);
  }

  // Step 2–3: Extract text (reuse cached extraction on re-clean to avoid
  // re-fetching URLs / re-parsing files — the source content is unchanged).
  const extractedPath = getSourceSnapshotPath(env.DATA_ROOT as string, source.id);

  let extractedText: string;
  if (fs.existsSync(extractedPath)) {
    extractedText = fs.readFileSync(extractedPath, 'utf-8');
  } else if (source.inputType === 'url') {
    throw new AppError(
      'EXTRACTION_FAILED',
      `Immutable URL snapshot is missing for source ${source.id}`,
    );
  } else {
    // File-based source — read the stored file and extract
    const filePath = path.join(env.DATA_ROOT as string, source.relativePath!);
    const fileBuffer = fs.readFileSync(filePath);
    const result = await extract(fileBuffer, source.mimeType ?? 'text/plain');
    extractedText = result.text;
    writeSourceSnapshot(extractedPath, extractedText);
  }

  // Step 4: CAS extracting → cleaning
  const casOk = jobsRepo.updateJobStatus(job.id, 'extracting', 'cleaning');
  if (!casOk) {
    throw new AppError('INVALID_STATE', 'CAS extracting→cleaning failed');
  }

  // Step 5–6: Run cleaning through the single OpenAI-compatible LLM path.
  // Qoder SDK is reserved for chat/agent workflows and never participates in
  // knowledge cleaning. Provider failures fail the job; the cleaner may still
  // try multiple configured OpenAI-compatible providers in order.
  const draftId = generateId();
  let cleanedMarkdown: string;
  try {
    cleanedMarkdown = await cleanWithLlmDirect({
      rawText: extractedText,
      sourceUrl: source.sourceUrl ?? undefined,
      feedback: job.instructionsJson ?? undefined,
      signal,
      maxOutputChars: MAX_CONTENT_CHARS,
      maxTokens: env.LLM_CLEAN_MAX_TOKENS,
      maxInputChars: env.LLM_CLEAN_MAX_INPUT_CHARS,
      sourceMetadata: {
        noteId: source.id,
        sourceId: source.id,
        sourceSha256: source.sha256,
        sourceName: source.originalName ?? undefined,
        sourceUrl: source.sourceUrl ?? undefined,
      },
    });
  } catch (err) {
    if (err instanceof CleaningInputTooLargeError) {
      throw new AppError('CONTENT_TOO_LARGE', err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError('AGENT_UNAVAILABLE', `LLM 直连清洗失败: ${message}`);
  }

  // Step 7: Parse Front Matter + Zod validation
  const parsed = parseFrontMatter(cleanedMarkdown);
  validateFrontMatter(parsed.frontMatter);
  assertTrustedSourceMetadata(parsed.frontMatter, source);

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
  const casOk2 = await jobsService.completeJob(job.id);
  if (!casOk2) {
    throw new AppError('INVALID_STATE', 'CAS cleaning→pending_review failed');
  }

  // Step 11: Create draft record (versioned for re-clean lineage)
  const wikiPath = generateWikiPath(parsed.frontMatter);
  const contentHash = crypto.createHash('sha256').update(cleanedMarkdown).digest('hex');

  // Compute version: re-clean jobs carry parentDraftId → parent.version + 1
  let version = 1;
  const parentDraftId = job.parentDraftId ?? null;
  if (parentDraftId) {
    const parent = knowledgeRepo.getDraft(parentDraftId);
    if (parent) version = parent.version + 1;
  }

  knowledgeRepo.createDraft({
    id: draftId,
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
    parentDraftId,
    version,
  });

  // Step 12: Supersede old drafts for the same source
  knowledgeRepo.supersedeOldDrafts(job.sourceId, draftId);

  // Step 13: Auto-run evaluation (heuristic + probe) so the review page shows
  // a scorecard immediately. Non-fatal — evaluation failure must not block review.
  try {
    await evaluateDraft(draftId, { deep: false });
  } catch (evalErr) {
    console.warn(
      `[Worker] Auto-eval failed for draft ${draftId}:`,
      evalErr instanceof Error ? evalErr.message : evalErr,
    );
  }
}

// ---------------------------------------------------------------------------
// Error handler — always routes to failJob, never throws
// ---------------------------------------------------------------------------

async function handleFailure(jobId: string, err: unknown, signal: AbortSignal): Promise<void> {
  let errorCode: string;
  let errorMessage: string;

  if (err instanceof AppError) {
    errorCode = err.code;
    errorMessage = err.message;
  } else if (signal.aborted) {
    errorCode = 'AGENT_UNAVAILABLE';
    errorMessage = 'Hard timeout (30min) exceeded';
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
