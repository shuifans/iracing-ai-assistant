import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies
vi.mock('@/modules/knowledge/repository', () => ({
  createSource: vi.fn(),
  getSource: vi.fn(),
  listSources: vi.fn(),
  findDuplicateBySha256: vi.fn(),
  getDraft: vi.fn(),
  updateDraft: vi.fn(),
  supersedeOldDrafts: vi.fn(),
  createItem: vi.fn(),
  getItem: vi.fn(),
  listItems: vi.fn(),
  archiveItem: vi.fn(),
  restoreItem: vi.fn(),
}));

vi.mock('@/modules/jobs/repository', () => ({
  getJob: vi.fn(),
  updateJobStatus: vi.fn(),
}));

vi.mock('@/modules/jobs/service', () => ({
  submitJob: vi.fn(),
  getJobStatus: vi.fn(),
  listJobs: vi.fn(),
}));

vi.mock('@/modules/knowledge/extractors/url', () => ({
  fetchUrl: vi.fn(),
}));

vi.mock('@/modules/knowledge/front-matter', () => ({
  parseFrontMatter: vi.fn(),
  validateFrontMatter: vi.fn(),
  generateWikiPath: vi.fn(),
}));

vi.mock('@/lib/uuid', () => ({
  generateId: vi.fn(() => 'mock-uuid'),
}));

vi.mock('@/lib/datetime', () => ({
  utcNow: vi.fn(() => '2026-07-12T00:00:00.000Z'),
}));

vi.mock('@/config/env', () => ({
  env: {
    DATA_ROOT: '/data',
    WIKI_ROOT: '/data/md-wiki',
    URL_FETCH_MAX_BYTES: 5242880,
  },
}));

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('crypto', () => ({
  createHash: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn(() => 'mock-sha256'),
  })),
}));

// Import after mocks
import * as knowledgeRepo from '@/modules/knowledge/repository';
import * as jobsRepo from '@/modules/jobs/repository';
import * as jobsService from '@/modules/jobs/service';
import { fetchUrl } from '@/modules/knowledge/extractors/url';
import { parseFrontMatter, validateFrontMatter, generateWikiPath } from '@/modules/knowledge/front-matter';
import { AppError } from '@/lib/errors';
import * as fs from 'fs';
import {
  submitFileSource,
  submitUrlSource,
  getSource,
  getItem,
  getDraftWithDiff,
  editDraft,
  approveDraft,
  rejectDraft,
  archiveItem,
  restoreItem,
} from '@/modules/knowledge/service';

const mockCreateSource = vi.mocked(knowledgeRepo.createSource);
const mockGetSource = vi.mocked(knowledgeRepo.getSource);
const mockFindDuplicate = vi.mocked(knowledgeRepo.findDuplicateBySha256);
const mockGetDraft = vi.mocked(knowledgeRepo.getDraft);
const mockUpdateDraft = vi.mocked(knowledgeRepo.updateDraft);
const mockSupersedeOldDrafts = vi.mocked(knowledgeRepo.supersedeOldDrafts);
const mockCreateItem = vi.mocked(knowledgeRepo.createItem);
const mockGetItem = vi.mocked(knowledgeRepo.getItem);
const mockArchiveItem = vi.mocked(knowledgeRepo.archiveItem);
const mockRestoreItem = vi.mocked(knowledgeRepo.restoreItem);
const mockGetJob = vi.mocked(jobsRepo.getJob);
const mockUpdateJobStatus = vi.mocked(jobsRepo.updateJobStatus);
const mockSubmitJob = vi.mocked(jobsService.submitJob);
const mockFetchUrl = vi.mocked(fetchUrl);
const mockParseFrontMatter = vi.mocked(parseFrontMatter);
const mockValidateFrontMatter = vi.mocked(validateFrontMatter);
const mockGenerateWikiPath = vi.mocked(generateWikiPath);
const mockMkdirSync = vi.mocked(fs.mkdirSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockExistsSync = vi.mocked(fs.existsSync);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockDraft(overrides?: Partial<any>) {
  return {
    id: 'draft-001',
    jobId: 'job-001',
    suggestedPath: 'track-technique/braking/slug.md',
    title: 'Test Draft',
    frontMatterJson: JSON.stringify({
      title: 'Test',
      category: 'track-technique',
      subcategory: 'braking',
      tags: ['test'],
    }),
    draftRelativePath: 'drafts/draft-001.md',
    contentSha256: 'sha256',
    status: 'pending_review',
    reviewNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

function makeMockSource(overrides?: Partial<any>) {
  return {
    id: 'source-001',
    inputType: 'file',
    originalName: 'test.md',
    mimeType: 'text/markdown',
    relativePath: 'uploads/knowledge/2026/07/source-001/original.md',
    sourceUrl: null,
    sha256: 'sha256',
    sizeBytes: 1024,
    status: 'stored',
    submittedBy: 'user-001',
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

function makeMockJob(overrides?: Partial<any>) {
  return {
    id: 'job-001',
    sourceId: 'source-001',
    status: 'pending_review',
    attempt: 0,
    maxAttempts: 3,
    availableAt: '2026-07-12T00:00:00.000Z',
    leaseOwner: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    progress: 0,
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

function makeMockItem(overrides?: Partial<any>) {
  return {
    id: 'item-001',
    sourceId: 'source-001',
    draftId: 'draft-001',
    title: 'Test Item',
    category: 'track-technique',
    subcategory: 'braking',
    tagsJson: '["test"]',
    sourceName: null,
    sourceUrl: null,
    season: '',
    wikiPath: 'track-technique/braking/test.md',
    status: 'published',
    gitCommitSha: null,
    wikiSyncStatus: 'committed',
    publishedBy: 'user-001',
    publishedAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — submitFileSource
// ---------------------------------------------------------------------------

describe('submitFileSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindDuplicate.mockReturnValue(null);
    mockCreateSource.mockReturnValue(makeMockSource());
    mockSubmitJob.mockResolvedValue({ jobId: 'job-001' });
  });

  it('should succeed with valid file', async () => {
    const result = await submitFileSource({
      file: Buffer.from('test content'),
      originalName: 'test.md',
      mimeType: 'text/markdown',
      submittedBy: 'user-001',
    });

    expect(result).toEqual({ sourceId: 'mock-uuid', jobId: 'job-001' });
    expect(mockMkdirSync).toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalled();
    expect(mockCreateSource).toHaveBeenCalled();
    expect(mockSubmitJob).toHaveBeenCalledWith('mock-uuid');
  });

  it('should throw UNSUPPORTED_MEDIA_TYPE for invalid MIME', async () => {
    await expect(
      submitFileSource({
        file: Buffer.from('test'),
        originalName: 'test.xyz',
        mimeType: 'application/octet-stream',
        submittedBy: 'user-001',
      }),
    ).rejects.toThrow('MIME type');
  });

  it('should throw DUPLICATE_SOURCE when sha256 exists', async () => {
    mockFindDuplicate.mockReturnValue(makeMockSource({ id: 'existing-source' }));

    await expect(
      submitFileSource({
        file: Buffer.from('duplicate'),
        originalName: 'dup.md',
        mimeType: 'text/markdown',
        submittedBy: 'user-001',
      }),
    ).rejects.toThrow('Duplicate source detected');
  });
});

// ---------------------------------------------------------------------------
// Tests — submitUrlSource
// ---------------------------------------------------------------------------

describe('submitUrlSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindDuplicate.mockReturnValue(null);
    mockCreateSource.mockReturnValue(makeMockSource({ inputType: 'url' }));
    mockSubmitJob.mockResolvedValue({ jobId: 'job-001' });
    mockFetchUrl.mockResolvedValue({
      text: 'fetched content',
      charCount: 14,
      truncated: false,
      warnings: [],
    });
  });

  it('should succeed with valid HTTPS URL', async () => {
    const result = await submitUrlSource({
      url: 'https://example.com/article',
      title: 'Test Article',
      submittedBy: 'user-001',
    });

    expect(result).toEqual({ sourceId: 'mock-uuid', jobId: 'job-001' });
    expect(mockFetchUrl).toHaveBeenCalledWith('https://example.com/article', expect.any(Object));
    expect(mockCreateSource).toHaveBeenCalled();
  });

  it('should throw ZodError for invalid URL', async () => {
    await expect(
      submitUrlSource({
        url: 'not-a-url',
        submittedBy: 'user-001',
      }),
    ).rejects.toThrow();
  });

  it('should throw DUPLICATE_SOURCE when sha256 exists', async () => {
    mockFindDuplicate.mockReturnValue(makeMockSource({ id: 'existing' }));

    await expect(
      submitUrlSource({
        url: 'https://example.com/dup',
        submittedBy: 'user-001',
      }),
    ).rejects.toThrow('Duplicate source detected');
  });
});

// ---------------------------------------------------------------------------
// Tests — getSource / getItem
// ---------------------------------------------------------------------------

describe('getSource', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should return source when found', async () => {
    const source = makeMockSource();
    mockGetSource.mockReturnValue(source);

    const result = await getSource('source-001');
    expect(result).toEqual(source);
  });

  it('should throw NOT_FOUND when source missing', async () => {
    mockGetSource.mockReturnValue(null);
    await expect(getSource('missing')).rejects.toThrow('not found');
  });
});

describe('getItem', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should return item when found', async () => {
    const item = makeMockItem();
    mockGetItem.mockReturnValue(item);

    const result = await getItem('item-001');
    expect(result).toEqual(item);
  });

  it('should throw NOT_FOUND when item missing', async () => {
    mockGetItem.mockReturnValue(null);
    await expect(getItem('missing')).rejects.toThrow('not found');
  });
});

// ---------------------------------------------------------------------------
// Tests — getDraftWithDiff
// ---------------------------------------------------------------------------

describe('getDraftWithDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDraft.mockReturnValue(makeMockDraft());
    mockGetJob.mockReturnValue(makeMockJob());
    mockGetSource.mockReturnValue(makeMockSource());
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('markdown content');
  });

  it('should return draft with source and text', async () => {
    const result = await getDraftWithDiff('draft-001');

    expect(result.draft.id).toBe('draft-001');
    expect(result.source.id).toBe('source-001');
    expect(result.renderedMarkdown).toBe('markdown content');
  });

  it('should throw NOT_FOUND when draft missing', async () => {
    mockGetDraft.mockReturnValue(null);
    await expect(getDraftWithDiff('missing')).rejects.toThrow('not found');
  });

  it('should throw NOT_FOUND when job missing', async () => {
    mockGetJob.mockReturnValue(null);
    await expect(getDraftWithDiff('draft-001')).rejects.toThrow('not found');
  });
});

// ---------------------------------------------------------------------------
// Tests — editDraft
// ---------------------------------------------------------------------------

describe('editDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDraft.mockReturnValue(makeMockDraft());
    mockParseFrontMatter.mockReturnValue({
      frontMatter: {
        title: 'Test',
        category: 'track-technique',
        subcategory: 'braking',
        tags: ['test'],
      },
      body: 'body content',
    });
    mockValidateFrontMatter.mockReturnValue({
      title: 'Test',
      category: 'track-technique',
      subcategory: 'braking',
      tags: ['test'],
    });
    mockGenerateWikiPath.mockReturnValue('track-technique/braking/test.md');
  });

  it('should save valid content', async () => {
    await editDraft('draft-001', '---\ntitle: Test\n---\nbody', 'user-001');

    expect(mockWriteFileSync).toHaveBeenCalled();
    expect(mockUpdateDraft).toHaveBeenCalledWith(
      'draft-001',
      expect.objectContaining({
        frontMatterJson: expect.any(String),
        contentSha256: expect.any(String),
      }),
    );
  });

  it('should throw DRAFT_INVALID when parseFrontMatter fails', async () => {
    mockParseFrontMatter.mockImplementation(() => {
      throw new AppError('DRAFT_INVALID', 'Bad front matter');
    });

    await expect(editDraft('draft-001', 'bad content', 'user-001')).rejects.toThrow(
      'Bad front matter',
    );
  });

  it('should throw NOT_FOUND when draft missing', async () => {
    mockGetDraft.mockReturnValue(null);
    await expect(editDraft('missing', 'content', 'user-001')).rejects.toThrow('not found');
  });
});

// ---------------------------------------------------------------------------
// Tests — approveDraft
// ---------------------------------------------------------------------------

describe('approveDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDraft.mockReturnValue(makeMockDraft());
    mockGetJob.mockReturnValue(makeMockJob());
    mockUpdateJobStatus.mockReturnValue(true);
    mockGenerateWikiPath.mockReturnValue('track-technique/braking/test.md');
    mockCreateItem.mockReturnValue(makeMockItem());
  });

  it('should publish pending_review draft successfully', async () => {
    const result = await approveDraft('draft-001', 'user-001', 'idempotency-key');

    expect(result.itemId).toBe('item-001');
    expect(result.wikiPath).toBe('track-technique/braking/test.md');
    expect(mockUpdateJobStatus).toHaveBeenCalledWith('job-001', 'pending_review', 'publishing');
    expect(mockCreateItem).toHaveBeenCalled();
    expect(mockSupersedeOldDrafts).toHaveBeenCalled();
    expect(mockUpdateDraft).toHaveBeenCalledWith(
      'draft-001',
      expect.objectContaining({ status: 'approved' }),
    );
    expect(mockUpdateJobStatus).toHaveBeenCalledWith('job-001', 'publishing', 'published');
  });

  it('should throw INVALID_STATE when draft not pending_review', async () => {
    mockGetDraft.mockReturnValue(makeMockDraft({ status: 'rejected' }));

    await expect(approveDraft('draft-001', 'user-001', 'key')).rejects.toThrow(
      'must be in pending_review',
    );
  });

  it('should throw INVALID_STATE when CAS fails', async () => {
    mockUpdateJobStatus.mockReturnValue(false);

    await expect(approveDraft('draft-001', 'user-001', 'key')).rejects.toThrow(
      'not in pending_review state',
    );
  });

  it('should supersede old drafts for same source', async () => {
    await approveDraft('draft-001', 'user-001', 'key');

    expect(mockSupersedeOldDrafts).toHaveBeenCalledWith('source-001', 'draft-001');
  });
});

// ---------------------------------------------------------------------------
// Tests — rejectDraft
// ---------------------------------------------------------------------------

describe('rejectDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDraft.mockReturnValue(makeMockDraft());
    mockUpdateJobStatus.mockReturnValue(true);
  });

  it('should reject with valid reason', async () => {
    await rejectDraft('draft-001', 'user-001', 'Not good enough');

    expect(mockUpdateJobStatus).toHaveBeenCalledWith('job-001', 'pending_review', 'rejected');
    expect(mockUpdateDraft).toHaveBeenCalledWith(
      'draft-001',
      expect.objectContaining({
        status: 'rejected',
        reviewNotes: 'Not good enough',
      }),
    );
  });

  it('should throw VALIDATION_ERROR for empty reason', async () => {
    await expect(rejectDraft('draft-001', 'user-001', '')).rejects.toThrow(
      'between 1 and 500',
    );
  });

  it('should throw VALIDATION_ERROR for reason > 500 chars', async () => {
    const longReason = 'a'.repeat(501);
    await expect(rejectDraft('draft-001', 'user-001', longReason)).rejects.toThrow(
      'between 1 and 500',
    );
  });

  it('should throw INVALID_STATE when draft not pending_review', async () => {
    mockGetDraft.mockReturnValue(makeMockDraft({ status: 'rejected' }));

    await expect(rejectDraft('draft-001', 'user-001', 'reason')).rejects.toThrow(
      "Cannot reject draft in 'rejected' state",
    );
  });

  it('should throw NOT_FOUND when draft missing', async () => {
    mockGetDraft.mockReturnValue(null);
    await expect(rejectDraft('missing', 'user-001', 'reason')).rejects.toThrow('not found');
  });
});

// ---------------------------------------------------------------------------
// Tests — archiveItem / restoreItem
// ---------------------------------------------------------------------------

describe('archiveItem', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should archive published item', async () => {
    mockGetItem.mockReturnValue(makeMockItem({ status: 'published' }));

    await archiveItem('item-001', 'user-001');

    expect(mockArchiveItem).toHaveBeenCalledWith('item-001');
  });

  it('should throw INVALID_STATE when not published', async () => {
    mockGetItem.mockReturnValue(makeMockItem({ status: 'archived' }));

    await expect(archiveItem('item-001', 'user-001')).rejects.toThrow(
      "Cannot archive item in 'archived' state",
    );
  });

  it('should throw NOT_FOUND when item missing', async () => {
    mockGetItem.mockReturnValue(null);
    await expect(archiveItem('missing', 'user-001')).rejects.toThrow('not found');
  });
});

describe('restoreItem', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should restore archived item', async () => {
    mockGetItem.mockReturnValue(makeMockItem({ status: 'archived' }));

    await restoreItem('item-001');

    expect(mockRestoreItem).toHaveBeenCalledWith('item-001');
  });

  it('should throw INVALID_STATE when not archived', async () => {
    mockGetItem.mockReturnValue(makeMockItem({ status: 'published' }));

    await expect(restoreItem('item-001')).rejects.toThrow(
      "Cannot restore item in 'published' state",
    );
  });

  it('should throw NOT_FOUND when item missing', async () => {
    mockGetItem.mockReturnValue(null);
    await expect(restoreItem('missing')).rejects.toThrow('not found');
  });
});
