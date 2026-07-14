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
import * as publisher from './publisher';
import * as jobsRepo from '@/modules/jobs/repository';
import * as jobsService from '@/modules/jobs/service';
import { fetchUrl } from './extractors/url';
import { parseFrontMatter, validateFrontMatter, generateWikiPath } from './front-matter';
import { AppError } from '@/lib/errors';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import { env } from '@/config/env';
import { getPublishGuardSettings, getEvaluationByDraftId } from '@/modules/knowledge-evaluation/repository';
import * as evalService from '@/modules/knowledge-evaluation/service';
import { submitUrlSchema, ALLOWED_KNOWLEDGE_MIMES } from './schemas';
import type {
  CursorPageParams,
  CursorPageResult,
  DraftReview,
  PublishResult,
  FrontMatterData,
  DraftListRow,
  DraftListItem,
  KnowledgeStats,
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

  // 5. Create source record (reuse the caller-generated sourceId so the job,
  // the upload dir, relative_path and the returned id all stay consistent).
  knowledgeRepo.createSource({
    id: sourceId,
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

  // 5. Create source record (reuse the caller-generated sourceId — see submitFileSource)
  const sourceId = generateId();
  knowledgeRepo.createSource({
    id: sourceId,
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
 * List cleaned drafts for the admin 候选稿 tab — pending_review by default,
 * enriched with evaluation tier/score, parsed category, and re-clean count.
 */
export async function listDrafts(
  params: CursorPageParams & { status?: string; sourceId?: string; tier?: string },
): Promise<CursorPageResult<DraftListItem>> {
  const result = knowledgeRepo.listDrafts(params);

  const items: DraftListItem[] = result.items.map((row: DraftListRow) => {
    let category: string | null = null;
    let subcategory: string | null = null;
    try {
      const fm = JSON.parse(row.draft.frontMatterJson) as {
        category?: string;
        subcategory?: string;
      };
      category = fm.category ?? null;
      subcategory = fm.subcategory ?? null;
    } catch {
      // malformed front matter JSON — leave category null
    }
    return {
      id: row.draft.id,
      title: row.draft.title,
      category,
      subcategory,
      sourceName: row.sourceOriginalName ?? row.sourceUrl ?? null,
      tier: row.tier,
      overallScore: row.overallScore,
      status: row.draft.status,
      version: row.draft.version,
      reCleanCount: Math.max(0, row.draft.version - 1),
      createdAt: row.draft.createdAt,
    };
  });

  return { items, nextCursor: result.nextCursor };
}

/**
 * Aggregate knowledge-base statistics for the admin 概览 dashboard.
 */
export async function getKnowledgeStats(): Promise<KnowledgeStats> {
  return knowledgeRepo.getKnowledgeStats();
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

/**
 * Get a knowledge item together with its published content (front matter +
 * body) for the backend detail view.
 *
 * Content is read from the canonical wiki file (${WIKI_ROOT}/${wikiPath}); for
 * legacy items published via the simplified approveDraft (which never wrote a
 * wiki file), falls back to the parent draft file on disk. Lets the backend
 * show the actual cleaned body of a published item — not just its metadata.
 */
export async function getItemWithContent(id: string): Promise<{
  item: KnowledgeItem;
  renderedMarkdown: string;
  body: string;
  frontMatter: FrontMatterData | null;
}> {
  const item = await getItem(id);

  const wikiFilePath = path.join(env.WIKI_ROOT as string, item.wikiPath);
  let content = '';
  if (fs.existsSync(wikiFilePath)) {
    content = fs.readFileSync(wikiFilePath, 'utf-8');
  } else {
    const parentDraft = knowledgeRepo.getDraft(item.draftId);
    if (parentDraft) {
      const draftFilePath = path.join(
        env.DATA_ROOT as string,
        'drafts',
        parentDraft.draftRelativePath,
      );
      if (fs.existsSync(draftFilePath)) {
        content = fs.readFileSync(draftFilePath, 'utf-8');
      }
    }
  }

  let body = content;
  let frontMatter: FrontMatterData | null = null;
  if (content) {
    try {
      const parsed = parseFrontMatter(content);
      body = parsed.body;
      frontMatter = parsed.frontMatter;
    } catch {
      // Malformed / front-matter-less content — show raw content as the body.
    }
  }

  return { item, renderedMarkdown: content, body, frontMatter };
}

// ---------------------------------------------------------------------------
// Draft review
// ---------------------------------------------------------------------------

/**
 * Get a draft with its associated source and extracted text for review.
 */
export async function getDraftWithDiff(draftId: string): Promise<DraftReview> {
  // Accept either a draft id or a job id — the review page is reached via
  // /knowledge/review/{jobId}, so resolve the draft flexibly.
  let draft = knowledgeRepo.getDraft(draftId);
  if (!draft) draft = knowledgeRepo.getDraftByJobId(draftId);
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

  // Optional publish guard: when enabled in system_settings, require a passing
  // evaluation before allowing publish. Off by default — evaluation is advisory.
  const guard = getPublishGuardSettings();
  if (guard.enabled) {
    const evaluation = getEvaluationByDraftId(draftId);
    const passed =
      !!evaluation &&
      (evaluation.status === 'heuristic_done' || evaluation.status === 'complete') &&
      evaluation.overallScore >= guard.minScore;
    if (!passed) {
      throw new AppError(
        'INVALID_STATE',
        `评估未通过发布门禁（需 ≥${guard.minScore} 分且评估完成，当前 ${
          evaluation ? `${evaluation.overallScore} 分 / ${evaluation.status}` : '未评估'
        }）`,
      );
    }
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
 * Publish a reviewed draft via the atomic eight-step publisher.
 *
 * This is the real publish path (replaces the simplified approveDraft): writes
 * the wiki file, rebuilds index.md, git commits, and — crucially for the
 * revision flow — upserts the knowledge_item by wikiPath so a re-published
 * revision overwrites the existing item in place instead of violating the
 * uniqueIndex(wikiPath). The publish guard + draft 'approved' bookkeeping are
 * handled inside publisher.publishDraft.
 */
export async function publishDraftReview(
  draftId: string,
  reviewedBy: string,
  // Idempotency key is accepted for API parity with approve/re-clean; the
  // publisher is itself CAS-guarded against duplicate concurrent publishes.
  _idempotencyKey: string,
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

  // Read the draft file (front matter + body) from disk and hand it to the
  // atomic publisher — same path math as getDraftWithDiff / editDraft.
  const draftFilePath = path.join(env.DATA_ROOT as string, 'drafts', draft.draftRelativePath);
  let draftContent = '';
  if (fs.existsSync(draftFilePath)) {
    draftContent = fs.readFileSync(draftFilePath, 'utf-8');
  }

  return publisher.publishDraft({
    draftId,
    jobId: draft.jobId,
    draftContent,
    reviewedBy,
  });
}

/**
 * Derive a revision draft from a published knowledge item.
 *
 * Copies the item's published content into a brand-new draft (status
 * pending_review, version = parent.version + 1, parentDraftId → item.draftId)
 * and creates a review-only job that bypasses the cleaning pipeline. The admin
 * then reviews / manually edits / re-cleans the draft, and approving it runs
 * the publisher's overwrite branch — updating the same item in place (preserving
 * the wikiPath unique constraint and git history) instead of creating a new row.
 */
export async function reviseItem(
  itemId: string,
  reviewedBy: string,
): Promise<{ draftId: string; jobId: string; version: number }> {
  const item = knowledgeRepo.getItem(itemId);
  if (!item) {
    throw new AppError('NOT_FOUND', `Knowledge item ${itemId} not found`);
  }
  if (item.status !== 'published') {
    throw new AppError(
      'INVALID_STATE',
      `只有已发布条目可派生修订草稿（当前状态 '${item.status}）；请先恢复该条目`,
    );
  }

  const parentDraft = knowledgeRepo.getDraft(item.draftId);
  if (!parentDraft) {
    throw new AppError('NOT_FOUND', `条目 ${itemId} 的父草稿 ${item.draftId} 不存在`);
  }

  // Read published content: prefer the canonical wiki file, fall back to the
  // parent draft file for items published via the legacy simplified approveDraft
  // (which never wrote a wiki file).
  const wikiFilePath = path.join(env.WIKI_ROOT as string, item.wikiPath);
  const parentDraftFilePath = path.join(
    env.DATA_ROOT as string,
    'drafts',
    parentDraft.draftRelativePath,
  );
  let content = '';
  if (fs.existsSync(wikiFilePath)) {
    content = fs.readFileSync(wikiFilePath, 'utf-8');
  } else if (fs.existsSync(parentDraftFilePath)) {
    content = fs.readFileSync(parentDraftFilePath, 'utf-8');
  }
  if (!content) {
    throw new AppError(
      'INVALID_STATE',
      `无法读取条目正文（wiki 文件与草稿文件均缺失）：${item.wikiPath}`,
    );
  }

  // Validate front matter before creating the revised draft.
  const parsed = parseFrontMatter(content);
  validateFrontMatter(parsed.frontMatter);

  // Write the revised draft to disk (verbatim copy — the admin edits in review).
  const newDraftId = generateId();
  const draftRelativePath = `${newDraftId}.md`;
  const newDraftFilePath = path.join(env.DATA_ROOT as string, 'drafts', draftRelativePath);
  fs.mkdirSync(path.dirname(newDraftFilePath), { recursive: true });
  fs.writeFileSync(newDraftFilePath, content, 'utf-8');
  const contentHash = sha256(content);

  // Review-only job: bypasses the cleaning pipeline, lands directly in
  // pending_review with a null lease so the worker never claims it.
  const job = jobsRepo.createReviewJob(item.sourceId, {
    parentDraftId: item.draftId,
    kind: 're_clean',
  });

  const version = parentDraft.version + 1;

  const draft = knowledgeRepo.createDraft({
    jobId: job.id,
    suggestedPath: item.wikiPath,
    title: parsed.frontMatter.title,
    frontMatterJson: JSON.stringify(parsed.frontMatter),
    draftRelativePath,
    contentSha256: contentHash,
    status: 'pending_review',
    reviewNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    parentDraftId: item.draftId,
    version,
  });

  // Supersede sibling pending drafts for the same source (mirrors worker
  // behavior so only this revised draft is reviewable).
  knowledgeRepo.supersedeOldDrafts(item.sourceId, draft.id);

  // Best-effort auto-evaluation (non-fatal — mirrors worker Step 13).
  try {
    await evalService.evaluateDraft(draft.id, { deep: false });
  } catch {
    /* evaluation failure must not block the revision */
  }

  return { draftId: draft.id, jobId: job.id, version };
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

// ---------------------------------------------------------------------------
// Git sync retry
// ---------------------------------------------------------------------------

/**
 * Retry git sync for every item currently in push_failed state.
 */
export async function retryGitSync(): Promise<number> {
  const failedItems = knowledgeRepo.listItemsBySyncStatus('push_failed');
  for (const item of failedItems) {
    await publisher.retryGitPush(item.id);
  }
  return failedItems.length;
}
