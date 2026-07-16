import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LeasedJob } from '@/modules/jobs/types';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('@/modules/knowledge/repository', () => ({
  getSource: vi.fn(),
  getDraft: vi.fn(),
  createDraft: vi.fn(),
  supersedeOldDrafts: vi.fn(),
  updateDraft: vi.fn(),
}));

vi.mock('@/modules/jobs/repository', () => ({
  updateJobStatus: vi.fn().mockReturnValue(true),
  getJob: vi.fn(),
}));

vi.mock('@/modules/jobs/service', () => ({
  failJob: vi.fn().mockResolvedValue(undefined),
  completeJob: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/modules/knowledge/extractors/index', () => ({
  extract: vi.fn(),
}));

vi.mock('@/modules/knowledge/extractors/url', () => ({
  fetchUrl: vi.fn(),
}));

vi.mock('@/modules/knowledge/front-matter', () => ({
  assertTrustedSourceMetadata: vi.fn(),
  parseFrontMatter: vi.fn(),
  validateFrontMatter: vi.fn(),
  generateWikiPath: vi.fn(),
}));

vi.mock('@/modules/knowledge-evaluation/service', () => ({
  evaluateDraft: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/config/env', () => ({
  env: {
    DATA_ROOT: '/data',
    WIKI_ROOT: '/data/md-wiki',
    URL_FETCH_MAX_BYTES: 5242880,
    LLM_CLEAN_MAX_INPUT_CHARS: 100000,
    LLM_CLEAN_MAX_TOKENS: 16000,
  },
}));

vi.mock('@/modules/knowledge/llm-cleaner', () => ({
  CleaningInputTooLargeError: class CleaningInputTooLargeError extends Error {},
  cleanWithLlmDirect: vi.fn(),
}));

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(Buffer.from('file content')),
  existsSync: vi.fn().mockReturnValue(false),
  linkSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('crypto', () => ({
  default: {},
  randomUUID: vi.fn(() => 'snapshot-uuid'),
  createHash: vi.fn().mockReturnValue({
    update: vi.fn().mockReturnValue({
      digest: vi.fn().mockReturnValue('abc123hash'),
    }),
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

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
import { cleanWithLlmDirect } from '@/modules/knowledge/llm-cleaner';
import { evaluateDraft } from '@/modules/knowledge-evaluation/service';
import * as fs from 'fs';

import { processKnowledgeJob } from '../../../../worker/processors/knowledge';

const mockGetSource = vi.mocked(knowledgeRepo.getSource);
const mockGetDraft = vi.mocked(knowledgeRepo.getDraft);
const mockCreateDraft = vi.mocked(knowledgeRepo.createDraft);
const mockSupersedeOldDrafts = vi.mocked(knowledgeRepo.supersedeOldDrafts);
const mockUpdateJobStatus = vi.mocked(jobsRepo.updateJobStatus);
const mockGetJob = vi.mocked(jobsRepo.getJob);
const mockFailJob = vi.mocked(jobsService.failJob);
const mockCompleteJob = vi.mocked(jobsService.completeJob);
const mockExtract = vi.mocked(extract);
const mockFetchUrl = vi.mocked(fetchUrl);
const mockParseFrontMatter = vi.mocked(parseFrontMatter);
const mockValidateFrontMatter = vi.mocked(validateFrontMatter);
const mockGenerateWikiPath = vi.mocked(generateWikiPath);
const mockCleanWithLlmDirect = vi.mocked(cleanWithLlmDirect);
const mockEvaluateDraft = vi.mocked(evaluateDraft);
const mockMkdirSync = vi.mocked(fs.mkdirSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLeasedJob(overrides: Partial<LeasedJob> = {}): LeasedJob {
  return {
    id: 'job-1',
    sourceId: 'source-1',
    status: 'extracting',
    leaseOwner: 'worker-1',
    leaseExpiresAt: '2026-07-12T00:05:00.000Z',
    attempt: 0,
    ...overrides,
  };
}

function makeSource(overrides: Record<string, unknown> = {}) {
  return {
    id: 'source-1',
    inputType: 'file',
    originalName: 'test.txt',
    mimeType: 'text/plain',
    relativePath: 'uploads/knowledge/2026/07/source-1/original.txt',
    sourceUrl: null,
    sha256: 'a'.repeat(64),
    sizeBytes: 100,
    status: 'stored',
    submittedBy: 'user-1',
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

function makeDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-1',
    jobId: 'job-1',
    suggestedPath: 'driving-technique/racing-line/test.md',
    title: 'Test',
    frontMatterJson: '{}',
    draftRelativePath: 'draft-1.md',
    contentSha256: 'hash',
    status: 'pending_review',
    reviewNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

const VALID_FRONT_MATTER = {
  id: 'source-1',
  title: 'Test Article',
  description: 'Test article description',
  category: 'driving-technique',
  subcategory: 'racing-line',
  tags: ['spa', 'driving'],
  aliases: [],
  source_id: 'source-1',
  source_sha256: 'a'.repeat(64),
  source_name: 'Test Source',
  season: '2026S3',
  updated_at: '2026-07-12',
};

const VALID_MARKDOWN = `---
id: source-1
title: Test Article
description: Test article description
category: driving-technique
subcategory: racing-line
tags: [spa, driving]
aliases: []
source_id: source-1
source_sha256: ${'a'.repeat(64)}
source_name: Test Source
season: 2026S3
updated_at: 2026-07-12
---

# Test Article

This is the body content of the test article.
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processKnowledgeJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateJobStatus.mockReturnValue(true);
    mockCompleteJob.mockResolvedValue(true);
    mockCreateDraft.mockReturnValue(makeDraft() as any);
    mockGenerateWikiPath.mockReturnValue('driving-technique/racing-line/test-article.md');
    // Default: no cached extraction → extract/fetch runs. Cache-hit tests override.
    mockExistsSync.mockReturnValue(false);
    mockCleanWithLlmDirect.mockResolvedValue(VALID_MARKDOWN);
  });

  // ─── Happy path: file extraction → cleaning → draft → pending_review ─────

  it('processes a file source end-to-end', async () => {
    mockGetSource.mockReturnValue(makeSource() as any);
    mockExtract.mockResolvedValue({
      text: 'extracted text content',
      charCount: 22,
      truncated: false,
      warnings: [],
    });
    mockParseFrontMatter.mockReturnValue({
      frontMatter: VALID_FRONT_MATTER as any,
      body: '# Test Article\n\nThis is the body content.',
    });
    mockValidateFrontMatter.mockReturnValue(VALID_FRONT_MATTER as any);
    mockGetJob.mockReturnValue({ sourceId: 'source-1' } as any);

    const job = makeLeasedJob();
    await processKnowledgeJob(job);

    // Verify extraction was called
    expect(mockExtract).toHaveBeenCalled();
    // Verify extracted text was written
    expect(mockWriteFileSync).toHaveBeenCalled();
    // Verify the direct LLM cleaner was called
    expect(mockCleanWithLlmDirect).toHaveBeenCalled();
    // Verify draft was created
    expect(mockCreateDraft).toHaveBeenCalled();
    // Verify CAS transitions: extracting→cleaning, then atomic completion.
    expect(mockUpdateJobStatus).toHaveBeenCalledWith('job-1', 'extracting', 'cleaning');
    expect(mockCompleteJob).toHaveBeenCalledWith('job-1');
    // Verify supersede old drafts
    expect(mockSupersedeOldDrafts).toHaveBeenCalled();
    // Verify auto-evaluation ran (heuristic + probe, non-deep)
    expect(mockEvaluateDraft).toHaveBeenCalledWith(expect.any(String), { deep: false });
  });

  // ─── Happy path: URL source ─────────────────────────────────────────────

  it('processes a URL source end-to-end', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('fetched url text content');
    mockGetSource.mockReturnValue(
      makeSource({
        inputType: 'url',
        sourceUrl: 'https://example.com/article',
        relativePath: null,
      }) as any,
    );
    mockParseFrontMatter.mockReturnValue({
      frontMatter: VALID_FRONT_MATTER as any,
      body: '# Test Article\n\nThis is the body content.',
    });
    mockValidateFrontMatter.mockReturnValue(VALID_FRONT_MATTER as any);
    mockGetJob.mockReturnValue({ sourceId: 'source-1' } as any);

    const job = makeLeasedJob();
    await processKnowledgeJob(job);

    expect(mockFetchUrl).not.toHaveBeenCalled();
    expect(mockReadFileSync).toHaveBeenCalledWith('/data/extracted/source-1.txt', 'utf-8');
    expect(mockCreateDraft).toHaveBeenCalled();
    expect(mockCompleteJob).toHaveBeenCalledWith('job-1');
  });

  it('fails when an immutable URL snapshot is missing and never re-fetches', async () => {
    mockGetSource.mockReturnValue(
      makeSource({
        inputType: 'url',
        sourceUrl: 'https://example.com/article',
        relativePath: null,
      }) as any,
    );

    await processKnowledgeJob(makeLeasedJob());

    expect(mockFetchUrl).not.toHaveBeenCalled();
    expect(mockFailJob).toHaveBeenCalledWith(
      'job-1',
      'EXTRACTION_FAILED',
      expect.stringContaining('snapshot is missing'),
    );
  });

  // ─── Extraction failure → failJob ───────────────────────────────────────

  it('does not create a draft and fails INVALID_STATE when completion CAS loses', async () => {
    mockGetSource.mockReturnValue(makeSource() as any);
    mockExtract.mockResolvedValue({
      text: 'extracted text content',
      charCount: 22,
      truncated: false,
      warnings: [],
    });
    mockParseFrontMatter.mockReturnValue({
      frontMatter: VALID_FRONT_MATTER as any,
      body: '# Test Article\n\nThis is the body content.',
    });
    mockValidateFrontMatter.mockReturnValue(VALID_FRONT_MATTER as any);
    mockCompleteJob.mockResolvedValue(false);

    await processKnowledgeJob(makeLeasedJob());

    expect(mockCompleteJob).toHaveBeenCalledWith('job-1');
    expect(mockCreateDraft).not.toHaveBeenCalled();
    expect(mockSupersedeOldDrafts).not.toHaveBeenCalled();
    expect(mockEvaluateDraft).not.toHaveBeenCalled();
    expect(mockFailJob).toHaveBeenCalledWith(
      'job-1',
      'INVALID_STATE',
      'CAS cleaning→pending_review failed',
    );
  });

  it('fails the job with EXTRACTION_FAILED when extraction throws', async () => {
    mockGetSource.mockReturnValue(makeSource() as any);
    mockExtract.mockRejectedValue(new Error('extraction error'));

    const job = makeLeasedJob();
    await processKnowledgeJob(job);

    expect(mockFailJob).toHaveBeenCalledWith(
      'job-1',
      'EXTRACTION_FAILED',
      expect.stringContaining('extraction error'),
    );
  });

  // ─── Front Matter validation failure → DRAFT_INVALID ────────────────────

  it('fails the job with DRAFT_INVALID when front matter is invalid', async () => {
    mockGetSource.mockReturnValue(makeSource() as any);
    mockExtract.mockResolvedValue({
      text: 'some text',
      charCount: 9,
      truncated: false,
      warnings: [],
    });
    mockCleanWithLlmDirect.mockResolvedValue('invalid markdown');
    const { AppError } = await import('@/lib/errors');
    mockParseFrontMatter.mockImplementation(() => {
      throw new AppError('DRAFT_INVALID', 'Bad front matter');
    });

    const job = makeLeasedJob();
    await processKnowledgeJob(job);

    expect(mockFailJob).toHaveBeenCalledWith('job-1', 'DRAFT_INVALID', expect.any(String));
  });

  // ─── Content too large → CONTENT_TOO_LARGE ──────────────────────────────

  it('fails the job with CONTENT_TOO_LARGE when content exceeds 12000 chars', async () => {
    mockGetSource.mockReturnValue(makeSource() as any);
    mockExtract.mockResolvedValue({
      text: 'some text',
      charCount: 9,
      truncated: false,
      warnings: [],
    });

    const longMarkdown = `---\ntitle: Long\n---\n\n${'x'.repeat(12_001)}`;
    mockCleanWithLlmDirect.mockResolvedValue(longMarkdown);
    mockParseFrontMatter.mockReturnValue({
      frontMatter: VALID_FRONT_MATTER as any,
      body: 'x'.repeat(12_001),
    });
    mockValidateFrontMatter.mockReturnValue(VALID_FRONT_MATTER as any);

    const job = makeLeasedJob();
    await processKnowledgeJob(job);

    expect(mockFailJob).toHaveBeenCalledWith('job-1', 'CONTENT_TOO_LARGE', expect.any(String));
  });

  // ─── Agent unavailable → AGENT_UNAVAILABLE ──────────────────────────────

  it('fails the job with AGENT_UNAVAILABLE when LLM direct cleaning throws', async () => {
    mockGetSource.mockReturnValue(makeSource() as any);
    mockExtract.mockResolvedValue({
      text: 'some text',
      charCount: 9,
      truncated: false,
      warnings: [],
    });

    mockCleanWithLlmDirect.mockRejectedValue(new Error('LLM connection refused'));

    const job = makeLeasedJob();
    await processKnowledgeJob(job);

    expect(mockFailJob).toHaveBeenCalledWith('job-1', 'AGENT_UNAVAILABLE', expect.any(String));
  });

  it('preserves CONTENT_TOO_LARGE for an oversized cleaning input', async () => {
    const { CleaningInputTooLargeError } = await import('@/modules/knowledge/llm-cleaner');
    mockGetSource.mockReturnValue(makeSource() as any);
    mockExtract.mockResolvedValue({
      text: 'oversized input',
      charCount: 15,
      truncated: false,
      warnings: [],
    });
    mockCleanWithLlmDirect.mockRejectedValue(
      new CleaningInputTooLargeError('请按系列、赛季或文档章节拆分来源后重新上传。'),
    );

    await processKnowledgeJob(makeLeasedJob());

    expect(mockFailJob).toHaveBeenCalledWith(
      'job-1',
      'CONTENT_TOO_LARGE',
      expect.stringContaining('拆分来源'),
    );
  });

  // ─── Source not found → EXTRACTION_FAILED ───────────────────────────────

  it('fails the job when source is not found', async () => {
    mockGetSource.mockReturnValue(null);

    const job = makeLeasedJob();
    await processKnowledgeJob(job);

    expect(mockFailJob).toHaveBeenCalledWith(
      'job-1',
      'EXTRACTION_FAILED',
      expect.stringContaining('Source'),
    );
  });

  // ─── Empty LLM result → invalid draft ─────────────────────────────────

  it('fails the job when LLM returns empty assistant text', async () => {
    mockGetSource.mockReturnValue(makeSource() as any);
    mockExtract.mockResolvedValue({
      text: 'some text',
      charCount: 9,
      truncated: false,
      warnings: [],
    });

    mockCleanWithLlmDirect.mockResolvedValue('');
    const { AppError } = await import('@/lib/errors');
    mockParseFrontMatter.mockImplementation(() => {
      throw new AppError('DRAFT_INVALID', 'Empty markdown');
    });

    const job = makeLeasedJob();
    await processKnowledgeJob(job);

    expect(mockFailJob).toHaveBeenCalled();
  });

  // ─── Re-clean: feedback injection + versioning ──────────────────────────

  it('passes job.instructionsJson to the cleaner and versions the draft', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('fetched');
    mockGetSource.mockReturnValue(
      makeSource({
        inputType: 'url',
        sourceUrl: 'https://example.com/x',
        relativePath: null,
      }) as any,
    );
    mockParseFrontMatter.mockReturnValue({
      frontMatter: VALID_FRONT_MATTER as any,
      body: 'body',
    });
    mockValidateFrontMatter.mockReturnValue(VALID_FRONT_MATTER as any);
    mockGetJob.mockReturnValue({ sourceId: 'source-1' } as any);
    // Re-clean carries a parent draft (v3) → new draft should be v4
    mockGetDraft.mockReturnValue({ version: 3 } as any);

    const job = makeLeasedJob({
      instructionsJson: '{"comments":["too verbose"]}',
      parentDraftId: 'parent-draft-1',
      jobKind: 're_clean',
    });
    await processKnowledgeJob(job);

    expect(mockCleanWithLlmDirect).toHaveBeenCalledWith(
      expect.objectContaining({ feedback: '{"comments":["too verbose"]}' }),
    );
    // Parent draft looked up for versioning
    expect(mockGetDraft).toHaveBeenCalledWith('parent-draft-1');
    // New draft created with parentDraftId + version 4
    const draftCall = mockCreateDraft.mock.calls[0]![0];
    expect(draftCall.parentDraftId).toBe('parent-draft-1');
    expect(draftCall.version).toBe(4);
  });

  // ─── Re-clean reuses cached extracted text (no re-fetch) ────────────────

  it('reuses cached extracted text and does not re-fetch the URL', async () => {
    mockExistsSync.mockReturnValue(true); // extracted cache hit
    mockGetSource.mockReturnValue(
      makeSource({
        inputType: 'url',
        sourceUrl: 'https://example.com/x',
        relativePath: null,
      }) as any,
    );
    mockParseFrontMatter.mockReturnValue({
      frontMatter: VALID_FRONT_MATTER as any,
      body: 'body',
    });
    mockValidateFrontMatter.mockReturnValue(VALID_FRONT_MATTER as any);
    mockGetJob.mockReturnValue({ sourceId: 'source-1' } as any);

    const job = makeLeasedJob();
    await processKnowledgeJob(job);

    // URL was NOT re-fetched (cache hit)
    expect(mockFetchUrl).not.toHaveBeenCalled();
    // Cleaner still ran (with cached text)
    expect(mockCleanWithLlmDirect).toHaveBeenCalled();
  });

  it('always uses LLM direct cleaning and ignores a legacy qoder-sdk setting', async () => {
    mockGetSource.mockReturnValue(makeSource() as any);
    mockExtract.mockResolvedValue({
      text: 'extracted text content',
      charCount: 22,
      truncated: false,
      warnings: [],
    });
    mockCleanWithLlmDirect.mockResolvedValue(VALID_MARKDOWN);
    mockParseFrontMatter.mockReturnValue({
      frontMatter: VALID_FRONT_MATTER as any,
      body: '# Test Article\n\nThis is the body content.',
    });
    mockValidateFrontMatter.mockReturnValue(VALID_FRONT_MATTER as any);
    mockGetJob.mockReturnValue({ sourceId: 'source-1' } as any);

    await processKnowledgeJob(makeLeasedJob());

    expect(mockCleanWithLlmDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        rawText: 'extracted text content',
        maxOutputChars: 12_000,
        maxTokens: 16_000,
      }),
    );
  });
});
