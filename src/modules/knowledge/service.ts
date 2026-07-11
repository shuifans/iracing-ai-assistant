/**
 * Knowledge service — core orchestration for the knowledge pipeline.
 *
 * Coordinates: repository + extractors + agent client + jobs.
 *
 * SPEC §13 — knowledge cleaning flow:
 * 1. Submit source (file or URL) → create source + enqueue job
 * 2. Query sources / jobs / items / drafts
 * 3. Draft review: view, edit, approve, reject
 * 4. Archive / restore knowledge items
 *
 * @module knowledge/service
 */

import * as knowledgeRepo from './repository';
import * as jobsRepo from '@/modules/jobs/repository';
import * as jobsService from '@/modules/jobs/service';
import { fetchUrl } from './extractors/url';
import { parseFrontMatter, validateFrontMatter, generateWikiPath } from './front-matter';
import { AppError } from '@/lib/errors';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import { env } from '@/config/env';
import { submitUrlSchema, ALLOWED_KNOWLEDGE_MIMES } from './schemas';
import type {
  CursorPageParams,
  CursorPageResult,
  DraftReview,
  PublishResult,
} from './types';
import type { KnowledgeSource, KnowledgeDraft, KnowledgeItem } from '@/db/schema/knowledge';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function getExtFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    'text/plain': 'txt',
    'text/markdown': 'md',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-excel': 'xls',
  };
  return map[mimeType] ?? 'bin';
}

function buildUploadDir(sourceId: string): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return path.join(env.DATA_ROOT as string, 'uploads', 'knowledge', yyyy, mm, sourceId);
}

// ---------------------------------------------------------------------------
// Source submission — file
// ---------------------------------------------------------------------------

/**
 * Submit a file-based knowledge source.
 *
 * 1. Validate MIME type
 * 2. Compute sha256
 * 3. Duplicate check
 * 4. Store raw file on disk
 * 5. Create source + job records
 */
export async function submitFileSource(params: {
  file: Buffer;
  originalName: string;
  mimeType: string;
  submittedBy: string;
}): Promise<{ sourceId: string; jobId: string }> {
  // 1. Validate MIME
  if (
    !ALLOWED_KNOWLEDGE_MIMES.includes(
      params.mimeType as (typeof ALLOWED_KNOWLEDGE_MIMES)[number],
    )
  ) {
    throw new AppError(
      'UNSUPPORTED_MEDIA_TYPE',
      `MIME type "${params.mimeType}" is not allowed. Allowed: ${ALLOWED_KNOWLEDGE_MIMES.join(', ')}`,
    );
  }

  // 2. Compute sha256
  const hash = sha256(params.file);

  // 3. Duplicate check
  const dup = knowledgeRepo.findDuplicateBySha256(hash);
  if (dup) {
    throw new AppError(
      'DUPLICATE_SOURCE',
      `Duplicate source detected — existing source ${dup.id} has the same content`,
    );
  }

  // 4. Generate sourceId and store file
  const sourceId = generateId();
  const dir = buildUploadDir(sourceId);
  fs.mkdirSync(dir, { recursive: true });

  const ext = getExtFromMime(params.mimeType);
  const filePath = path.join(dir, `original.${ext}`);
  fs.writeFileSync(filePath, params.file);

  const relativePath = path.relative(env.DATA_ROOT as string, filePath);

  // 5. Create source record
  knowledgeRepo.createSource({
    inputType: 'file',
    originalName: params.originalName,
    mimeType: params.mimeType,
    relativePath,
    sourceUrl: null,
    sha256: hash,
    sizeBytes: params.file.length,
    status: 'stored',
    submittedBy: params.submittedBy,
  });

  // 6. Create job
  const { jobId } = await jobsService.submitJob(sourceId);

  return { sourceId, jobId };
}

// ---------------------------------------------------------------------------
// Source submission — URL
// ---------------------------------------------------------------------------

/**
 * Submit a URL-based knowledge source.
 *
 * 1. Validate URL via Zod schema
 * 2. Fetch URL content
 * 3. Compute sha256
 * 4. Duplicate check
 * 5. Create source + job records
 */
export async function submitUrlSource(params: {
  url: string;
  title?: string;
  submittedBy: string;
}): Promise<{ sourceId: string; jobId: string }> {
  // 1. Validate URL
  const parsed = submitUrlSchema.parse({ url: params.url, title: params.title });

  // 2. Fetch URL content
  const extraction = await fetchUrl(parsed.url, {
    maxBytes: env.URL_FETCH_MAX_BYTES as number,
    connectTimeoutMs: 5000,
    downloadTimeoutMs: 15000,
    maxRedirects: 3,
  });

  // 3. Compute sha256
  const hash = sha256(extraction.text);

  // 4. Duplicate check
  const dup = knowledgeRepo.findDuplicateBySha256(hash);
  if (dup) {
    throw new AppError(
      'DUPLICATE_SOURCE',
      `Duplicate source detected — existing source ${dup.id} has the same content`,
    );
  }

  // 5. Create source record
  const sourceId = generateId();
  knowledgeRepo.createSource({
    inputType: 'url',
    originalName: parsed.title ?? null,
    mimeType: 'text/html',
    relativePath: null,
    sourceUrl: parsed.url,
    sha256: hash,
    sizeBytes: extraction.charCount,
    status: 'stored',
    submittedBy: params.submittedBy,
  });

  // 6. Create job
  const { jobId } = await jobsService.submitJob(sourceId);

  return { sourceId, jobId };
}

// ---------------------------------------------------------------------------
// Query functions — thin wrappers over repository
// ---------------------------------------------------------------------------

/**
 * List knowledge sources with cursor-based pagination.
 */
export async function listSources(
  params: CursorPageParams & { status?: string },
): Promise<CursorPageResult<KnowledgeSource>> {
  return knowledgeRepo.listSources(params);
}

/**
 * Get a single knowledge source by ID.
 */
export async function getSource(id: string): Promise<KnowledgeSource> {
  const source = knowledgeRepo.getSource(id);
  if (!source) {
    throw new AppError('NOT_FOUND', `Knowledge source ${id} not found`);
  }
  return source;
}

/**
 * List jobs with cursor-based pagination.
 */
export async function listJobs(params: {
  limit?: number;
  cursor?: string;
  status?: string;
  sourceId?: string;
}): Promise<CursorPageResult<any>> {
  return jobsService.listJobs(params);
}

/**
 * Get job status and progress.
 */
export async function getJobStatus(jobId: string): Promise<any> {
  return jobsService.getJobStatus(jobId);
}

/**
 * List knowledge items with cursor-based pagination.
 */
export async function listItems(
  params: CursorPageParams & { category?: string; status?: string },
): Promise<CursorPageResult<KnowledgeItem>> {
  return knowledgeRepo.listItems(params);
}

/**
 * Get a single knowledge item by ID.
 */
export async function getItem(id: string): Promise<KnowledgeItem> {
  const item = knowledgeRepo.getItem(id);
  if (!item) {
    throw new AppError('NOT_FOUND', `Knowledge item ${id} not found`);
  }
  return item;
}

// ---------------------------------------------------------------------------
// Draft review
// ---------------------------------------------------------------------------

/**
 * Get a draft with its associated source and extracted text for review.
 */
export async function getDraftWithDiff(draftId: string): Promise<DraftReview> {
  const draft = knowledgeRepo.getDraft(draftId);
  if (!draft) {
    throw new AppError('NOT_FOUND', `Draft ${draftId} not found`);
  }

  // Get the job → source chain
  const job = jobsRepo.getJob(draft.jobId);
  if (!job) {
    throw new AppError('NOT_FOUND', `Job for draft ${draftId} not found`);
  }

  const source = knowledgeRepo.getSource(job.sourceId);
  if (!source) {
    throw new AppError('NOT_FOUND', `Source for draft ${draftId} not found`);
  }

  // Read draft file content
  let renderedMarkdown = '';
  const draftFilePath = path.join(env.DATA_ROOT as string, 'drafts', draft.draftRelativePath);
  if (fs.existsSync(draftFilePath)) {
    renderedMarkdown = fs.readFileSync(draftFilePath, 'utf-8');
  }

  // Read extracted text (if available — stored alongside source)
  let extractedText: string | null = null;
  if (source.relativePath) {
    const extractedPath = path.join(
      env.DATA_ROOT as string,
      source.relativePath,
      '..',
      'extracted.txt',
    );
    if (fs.existsSync(extractedPath)) {
      extractedText = fs.readFileSync(extractedPath, 'utf-8');
    }
  }

  return {
    draft,
    source,
    extractedText,
    renderedMarkdown,
  };
}

/**
 * Edit a draft's content.
 *
 * 1. Parse and validate Front Matter
 * 2. Write updated content to disk
 * 3. Update draft record
 */
export async function editDraft(
  draftId: string,
  content: string,
  reviewedBy: string,
): Promise<void> {
  const draft = knowledgeRepo.getDraft(draftId);
  if (!draft) {
    throw new AppError('NOT_FOUND', `Draft ${draftId} not found`);
  }

  // Parse Front Matter from the content and validate
  const parsed = parseFrontMatter(content);
  validateFrontMatter(parsed.frontMatter);

  // Write draft file to disk
  const draftFilePath = path.join(env.DATA_ROOT as string, 'drafts', draft.draftRelativePath);
  fs.writeFileSync(draftFilePath, content, 'utf-8');

  // Compute sha256 of new content
  const contentHash = sha256(content);

  // Update draft record
  knowledgeRepo.updateDraft(draftId, {
    suggestedPath: generateWikiPath(parsed.frontMatter),
    frontMatterJson: JSON.stringify(parsed.frontMatter),
    contentSha256: contentHash,
    reviewedBy,
  });
}

/**
 * Approve a draft and publish as a knowledge item.
 *
 * 1. Verify draft is pending_review
 * 2. CAS: job pending_review → publishing
 * 3. Parse Front Matter → generate wiki path
 * 4. Create knowledge item (simplified — full publish in D13)
 * 5. Supersede old drafts
 * 6. CAS: job publishing → published
 */
export async function approveDraft(
  draftId: string,
  reviewedBy: string,
  idempotencyKey: string,
): Promise<PublishResult> {
  const draft = knowledgeRepo.getDraft(draftId);
  if (!draft) {
    throw new AppError('NOT_FOUND', `Draft ${draftId} not found`);
  }

  if (draft.status !== 'pending_review') {
    throw new AppError(
      'INVALID_STATE',
      `Draft must be in pending_review status to be approved, got '${draft.status}'`,
    );
  }

  // CAS: job pending_review → publishing
  const casOk = jobsRepo.updateJobStatus(draft.jobId, 'pending_review', 'publishing');
  if (!casOk) {
    throw new AppError(
      'INVALID_STATE',
      'Job is not in pending_review state — cannot approve',
    );
  }

  // Parse front matter from draft record
  const frontMatter = JSON.parse(draft.frontMatterJson);
  const wikiPath = generateWikiPath(frontMatter);

  // Create knowledge item (simplified publish — full version in D13)
  const item = knowledgeRepo.createItem({
    sourceId: (jobsRepo.getJob(draft.jobId) as any).sourceId,
    draftId: draft.id,
    title: frontMatter.title,
    category: frontMatter.category,
    subcategory: frontMatter.subcategory,
    tagsJson: JSON.stringify(frontMatter.tags),
    sourceName: frontMatter.source_name ?? null,
    sourceUrl: frontMatter.source_url ?? null,
    season: frontMatter.season ?? '',
    wikiPath,
    status: 'published',
    gitCommitSha: null,
    wikiSyncStatus: 'committed',
    publishedBy: reviewedBy,
    publishedAt: utcNow(),
  });

  // Supersede old drafts for the same source
  const job = jobsRepo.getJob(draft.jobId);
  if (job) {
    knowledgeRepo.supersedeOldDrafts(job.sourceId, draft.id);
  }

  // Update draft status
  knowledgeRepo.updateDraft(draftId, {
    status: 'approved',
    reviewedBy,
    reviewedAt: utcNow(),
  });

  // CAS: job publishing → published
  jobsRepo.updateJobStatus(draft.jobId, 'publishing', 'published');

  return {
    itemId: item.id,
    wikiPath,
    gitCommitSha: null,
    wikiSyncStatus: 'committed',
  };
}

/**
 * Reject a draft with a reason.
 *
 * 1. Validate reason length (1-500)
 * 2. Verify draft exists
 * 3. CAS: job pending_review → rejected
 * 4. Update draft record
 */
export async function rejectDraft(
  draftId: string,
  reviewedBy: string,
  reason: string,
): Promise<void> {
  // 1. Reason length check
  if (!reason || reason.length < 1 || reason.length > 500) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Rejection reason must be between 1 and 500 characters',
    );
  }

  const draft = knowledgeRepo.getDraft(draftId);
  if (!draft) {
    throw new AppError('NOT_FOUND', `Draft ${draftId} not found`);
  }

  if (draft.status !== 'pending_review') {
    throw new AppError(
      'INVALID_STATE',
      `Cannot reject draft in '${draft.status}' state — must be pending_review`,
    );
  }

  // CAS: job pending_review → rejected
  const casOk = jobsRepo.updateJobStatus(draft.jobId, 'pending_review', 'rejected');
  if (!casOk) {
    throw new AppError(
      'INVALID_STATE',
      'Job is not in pending_review state — cannot reject',
    );
  }

  // Update draft record
  knowledgeRepo.updateDraft(draftId, {
    status: 'rejected',
    reviewNotes: reason,
    reviewedBy,
    reviewedAt: utcNow(),
  });
}

// ---------------------------------------------------------------------------
// Archive & Restore
// ---------------------------------------------------------------------------

/**
 * Archive a published knowledge item.
 */
export async function archiveItem(id: string, archivedBy: string): Promise<void> {
  const item = knowledgeRepo.getItem(id);
  if (!item) {
    throw new AppError('NOT_FOUND', `Knowledge item ${id} not found`);
  }
  if (item.status !== 'published') {
    throw new AppError(
      'INVALID_STATE',
      `Cannot archive item in '${item.status}' state — must be 'published'`,
    );
  }
  knowledgeRepo.archiveItem(id);
}

/**
 * Restore an archived knowledge item.
 */
export async function restoreItem(id: string): Promise<void> {
  const item = knowledgeRepo.getItem(id);
  if (!item) {
    throw new AppError('NOT_FOUND', `Knowledge item ${id} not found`);
  }
  if (item.status !== 'archived') {
    throw new AppError(
      'INVALID_STATE',
      `Cannot restore item in '${item.status}' state — must be 'archived'`,
    );
  }
  knowledgeRepo.restoreItem(id);
}
