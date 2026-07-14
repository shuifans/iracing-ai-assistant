import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LeasedJob } from '@/modules/jobs/types';
import type { SDKMessage } from '@qoder-ai/qoder-agent-sdk';

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
  completeJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/modules/knowledge/extractors/index', () => ({
  extract: vi.fn(),
}));

vi.mock('@/modules/knowledge/extractors/url', () => ({
  fetchUrl: vi.fn(),
}));

vi.mock('@/modules/knowledge/front-matter', () => ({
  parseFrontMatter: vi.fn(),
  validateFrontMatter: vi.fn(),
  generateWikiPath: vi.fn(),
}));

vi.mock('@/modules/agent/client', () => ({
  createCleaningQuery: vi.fn(),
}));

vi.mock('@/modules/knowledge-evaluation/service', () => ({
  evaluateDraft: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/config/env', () => ({
  env: {
    DATA_ROOT: '/data',
    WIKI_ROOT: '/data/md-wiki',
    QODER_CLEAN_TIMEOUT_MS: 900000,
    URL_FETCH_MAX_BYTES: 5242880,
    LLM_CLEAN_TIMEOUT_MS: 120000,
  },
}));

vi.mock('@/modules/system-settings/repository', () => ({
  getCleaningBackend: vi.fn(),
}));

vi.mock('@/modules/knowledge/llm-cleaner', () => ({
  cleanWithLlmDirect: vi.fn(),
}));

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(Buffer.from('file content')),
  existsSync: vi.fn().mockReturnValue(false),
}));

vi.mock('crypto', () => ({
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
import { createCleaningQuery } from '@/modules/agent/client';
import { cleanWithLlmDirect } from '@/modules/knowledge/llm-cleaner';
import { getCleaningBackend } from '@/modules/system-settings/repository';
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
const mockCreateCleaningQuery = vi.mocked(createCleaningQuery);
const mockCleanWithLlmDirect = vi.mocked(cleanWithLlmDirect);
const mockGetCleaningBackend = vi.mocked(getCleaningBackend);
const mockEvaluateDraft = vi.mocked(evaluateDraft);
const mockMkdirSync = vi.mocked(fs.mkdirSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockExistsSync = vi.mocked(fs.existsSync);

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
    sha256: 'hash',
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
    suggestedPath: 'track-technique/driving-line/test.md',
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

/**
 * Build an async generator that yields SDK messages for the cleaning query.
 */
function makeSdkGenerator(messages: SDKMessage[]): AsyncGenerator<SDKMessage> {
  async function* gen() {
    for (const msg of messages) {
      yield msg;
    }
  }
  return gen();
}

function makeCleaningResultSdkMessages(markdown: string): SDKMessage[] {
  return [
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: markdown }],
      },
    } as unknown as SDKMessage,
    {
      type: 'result',
      subtype: 'success',
      cost_usd: 0.01,
      is_error: false,
      duration_ms: 1000,
      duration_api_ms: 900,
      num_turns: 1,
      session_id: 'sess-1',
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50 },
    } as unknown as SDKMessage,
  ];
}

const VALID_FRONT_MATTER = {
  title: 'Test Article',
  category: 'track-technique',
  subcategory: 'driving-line',
  tags: ['spa', 'driving'],
  source_name: 'Test Source',
  season: '2026S3',
  updated_at: '2026-07-12',
};

const VALID_MARKDOWN = `---
title: Test Article
category: track-technique
subcategory: driving-line
tags: [spa, driving]
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
    mockCreateDraft.mockReturnValue(makeDraft() as any);
    mockGenerateWikiPath.mockReturnValue('track-technique/driving-line/test-article.md');
    // Default: no cached extraction → extract/fetch runs. Cache-hit tests override.
    mockExistsSync.mockReturnValue(false);
    // Default backend = qoder-sdk so existing createCleaningQuery tests pass.
    // llm-direct tests override this below.
    mockGetCleaningBackend.mockReturnValue('qoder-sdk');
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
    mockCreateCleaningQuery.mockReturnValue(
      makeSdkGenerator(makeCleaningResultSdkMessages(VALID_MARKDOWN)),
    );
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
    // Verify cleaning query was created
    expect(mockCreateCleaningQuery).toHaveBeenCalled();
    // Verify draft was created
    expect(mockCreateDraft).toHaveBeenCalled();
    // Verify CAS transitions: extracting→cleaning, cleaning→pending_review
    expect(mockUpdateJobStatus).toHaveBeenCalledWith('job-1', 'extracting', 'cleaning');
    expect(mockUpdateJobStatus).toHaveBeenCalledWith('job-1', 'cleaning', 'pending_review');
    // Verify supersede old drafts
    expect(mockSupersedeOldDrafts).toHaveBeenCalled();
    // Verify auto-evaluation ran (heuristic + probe, non-deep)
    expect(mockEvaluateDraft).toHaveBeenCalledWith(expect.any(String), { deep: false });
  });

  // ─── Happy path: URL source ─────────────────────────────────────────────

  it('processes a URL source end-to-end', async () => {
    mockGetSource.mockReturnValue(
      makeSource({
        inputType: 'url',
        sourceUrl: 'https://example.com/article',
        relativePath: null,
      }) as any,
    );
    mockFetchUrl.mockResolvedValue({
      text: 'fetched url text content',
      charCount: 24,
      truncated: false,
      warnings: [],
    });
    mockCreateCleaningQuery.mockReturnValue(
      makeSdkGenerator(makeCleaningResultSdkMessages(VALID_MARKDOWN)),
    );
    mockParseFrontMatter.mockReturnValue({
      frontMatter: VALID_FRONT_MATTER as any,
      body: '# Test Article\n\nThis is the body content.',
    });
    mockValidateFrontMatter.mockReturnValue(VALID_FRONT_MATTER as any);
    mockGetJob.mockReturnValue({ sourceId: 'source-1' } as any);

    const job = makeLeasedJob();
    await processKnowledgeJob(job);

    expect(mockFetchUrl).toHaveBeenCalledWith(
      'https://example.com/article',
      expect.any(Object),
    );
    expect(mockCreateDraft).toHaveBeenCalled();
    expect(mockUpdateJobStatus).toHaveBeenCalledWith('job-1', 'cleaning', 'pending_review');
  });

  // ─── Extraction failure → failJob ───────────────────────────────────────

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
    mockCreateCleaningQuery.mockReturnValue(
      makeSdkGenerator(makeCleaningResultSdkMessages('invalid markdown')),
    );
    const { AppError } = await import('@/lib/errors');
    mockParseFrontMatter.mockImplementation(() => {
      throw new AppError('DRAFT_INVALID', 'Bad front matter');
    });

    const job = makeLeasedJob();
    await processKnowledgeJob(job);

    expect(mockFailJob).toHaveBeenCalledWith(
      'job-1',
      'DRAFT_INVALID',
      expect.any(String),
    );
  });

  // ─── Content too large → CONTENT_TOO_LARGE ──────────────────────────────

  it('fails the job with CONTENT_TOO_LARGE when content exceeds 5000 chars', async () => {
    mockGetSource.mockReturnValue(makeSource() as any);
    mockExtract.mockResolvedValue({
      text: 'some text',
      charCount: 9,
      truncated: false,
      warnings: [],
    });

    const longMarkdown = `---\ntitle: Long\n---\n\n${'x'.repeat(5001)}`;
    mockCreateCleaningQuery.mockReturnValue(
      makeSdkGenerator(makeCleaningResultSdkMessages(longMarkdown)),
    );
    mockParseFrontMatter.mockReturnValue({
      frontMatter: VALID_FRONT_MATTER as any,
      body: 'x'.repeat(5001),
    });
    mockValidateFrontMatter.mockReturnValue(VALID_FRONT_MATTER as any);

    const job = makeLeasedJob();
    await processKnowledgeJob(job);

    expect(mockFailJob).toHaveBeenCalledWith(
      'job-1',
      'CONTENT_TOO_LARGE',
      expect.any(String),
    );
  });

  // ─── Agent unavailable → AGENT_UNAVAILABLE ──────────────────────────────

  it('fails the job with AGENT_UNAVAILABLE when SDK throws', async () => {
    mockGetSource.mockReturnValue(makeSource() as any);
    mockExtract.mockResolvedValue({
      text: 'some text',
      charCount: 9,
      truncated: false,
      warnings: [],
    });

    async function* failingGen(): AsyncGenerator<SDKMessage> {
      throw new Error('SDK connection refused');
    }
    mockCreateCleaningQuery.mockReturnValue(failingGen());

    const job = makeLeasedJob();
    await processKnowledgeJob(job);

    expect(mockFailJob).toHaveBeenCalledWith(
      'job-1',
      'AGENT_UNAVAILABLE',
      expect.any(String),
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

  // ─── Empty SDK result → AGENT_UNAVAILABLE ──────────────────────────────

  it('fails the job when SDK returns no assistant text', async () => {
    mockGetSource.mockReturnValue(makeSource() as any);
    mockExtract.mockResolvedValue({
      text: 'some text',
      charCount: 9,
      truncated: false,
      warnings: [],
    });

    // Generator that only yields a result/success but no assistant message
    async function* emptyGen(): AsyncGenerator<SDKMessage> {
      yield {
        type: 'result',
        subtype: 'success',
        cost_usd: 0,
        is_error: false,
        duration_ms: 100,
        duration_api_ms: 50,
        num_turns: 1,
        session_id: 'sess-1',
        total_cost_usd: 0,
        usage: { input_tokens: 10, output_tokens: 0 },
      } as unknown as SDKMessage;
    }
    mockCreateCleaningQuery.mockReturnValue(emptyGen());

    const job = makeLeasedJob();
    await processKnowledgeJob(job);

    expect(mockFailJob).toHaveBeenCalled();
  });

  // ─── Re-clean: feedback injection + versioning ──────────────────────────

  it('passes job.instructionsJson to the cleaner and versions the draft', async () => {
    mockGetSource.mockReturnValue(
      makeSource({
        inputType: 'url',
        sourceUrl: 'https://example.com/x',
        relativePath: null,
      }) as any,
    );
    mockFetchUrl.mockResolvedValue({
      text: 'fetched',
      charCount: 7,
      truncated: false,
      warnings: [],
    });
    mockCreateCleaningQuery.mockReturnValue(
      makeSdkGenerator(makeCleaningResultSdkMessages(VALID_MARKDOWN)),
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

    // Feedback forwarded to the cleaner as the 4th arg
    const cleanerCall = mockCreateCleaningQuery.mock.calls[0]!;
    expect(cleanerCall[3]).toBe('{"comments":["too verbose"]}');
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
    mockCreateCleaningQuery.mockReturnValue(
      makeSdkGenerator(makeCleaningResultSdkMessages(VALID_MARKDOWN)),
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
    expect(mockCreateCleaningQuery).toHaveBeenCalled();
  });

  // ─── llm-direct backend: cleanWithLlmDirect path (no Qoder fallback) ─────

  describe('llm-direct backend', () => {
    beforeEach(() => {
      mockGetCleaningBackend.mockReturnValue('llm-direct');
    });

    it('uses cleanWithLlmDirect (not the SDK) and completes the pipeline', async () => {
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

      const job = makeLeasedJob();
      await processKnowledgeJob(job);

      // LLM-direct was used
      expect(mockCleanWithLlmDirect).toHaveBeenCalledWith(
        expect.objectContaining({
          maxOutputChars: 4500,
          maxTokens: 2500,
          rawText: 'extracted text content',
        }),
      );
      // Qoder SDK was NOT used (strict binary — no fallback on the chosen backend)
      expect(mockCreateCleaningQuery).not.toHaveBeenCalled();
      // Pipeline still completed: draft created, CAS to pending_review
      expect(mockCreateDraft).toHaveBeenCalled();
      expect(mockUpdateJobStatus).toHaveBeenCalledWith('job-1', 'cleaning', 'pending_review');
    });

    it('fails with AGENT_UNAVAILABLE when cleanWithLlmDirect throws (no Qoder fallback)', async () => {
      mockGetSource.mockReturnValue(makeSource() as any);
      mockExtract.mockResolvedValue({
        text: 'some text',
        charCount: 9,
        truncated: false,
        warnings: [],
      });
      mockCleanWithLlmDirect.mockRejectedValue(new Error('LongCat rate limited'));

      const job = makeLeasedJob();
      await processKnowledgeJob(job);

      // Job failed with AGENT_UNAVAILABLE
      expect(mockFailJob).toHaveBeenCalledWith(
        'job-1',
        'AGENT_UNAVAILABLE',
        expect.stringContaining('LongCat rate limited'),
      );
      // Qoder SDK was NOT used as a fallback (strict binary)
      expect(mockCreateCleaningQuery).not.toHaveBeenCalled();
    });
  });
});
