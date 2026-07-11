import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — factory functions (vitest hoists vi.mock before imports)
// ---------------------------------------------------------------------------

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  openSync: vi.fn(() => 10),
  writeSync: vi.fn(() => 0),
  fsyncSync: vi.fn(),
  closeSync: vi.fn(),
  readFileSync: vi.fn(() => '---\ntitle: Test\n---\n\nBody'),
  existsSync: vi.fn(() => false),
  copyFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('child_process', () => {
  const execSync = vi.fn(() => Buffer.from(''));
  const spawn = vi.fn(() => ({ on: vi.fn() }));
  return {
    default: { execSync, spawn },
    execSync,
    spawn,
  };
});

vi.mock('@/modules/knowledge/wiki-index', () => ({
  rebuildIndex: vi.fn(() => '# Knowledge Index\n'),
  writeIndex: vi.fn(),
}));

vi.mock('@/modules/knowledge/front-matter', () => ({
  parseFrontMatter: vi.fn(() => ({
    frontMatter: {
      title: 'Test',
      category: 'basics',
      subcategory: 'getting-started',
      tags: ['test'],
    },
    body: 'Body',
  })),
  generateWikiPath: vi.fn(() => 'basics/getting-started/test.md'),
}));

vi.mock('@/modules/knowledge/repository', () => ({
  getItemByWikiPath: vi.fn(() => null),
  getItem: vi.fn(() => null),
  createItem: vi.fn(() => ({ id: 'mock-item-id' })),
  updateItem: vi.fn(),
  updateSyncStatus: vi.fn(),
}));

vi.mock('@/modules/jobs/repository', () => ({
  updateJobStatus: vi.fn(() => true),
  getJob: vi.fn(() => ({ sourceId: 'src-001' })),
}));

vi.mock('@/config/env', () => ({
  env: {
    WIKI_ROOT: '/data/md-wiki',
    WIKI_GIT_REMOTE: 'origin',
    WIKI_GIT_BRANCH: 'main',
  },
}));

vi.mock('@/lib/uuid', () => ({
  generateId: vi.fn(() => 'id-00000000-0000-0000-0000-000000000001'),
}));

vi.mock('@/lib/datetime', () => ({
  utcNow: vi.fn(() => '2026-07-12T00:00:00.000Z'),
}));

vi.mock('@/db/client', () => ({
  getDb: vi.fn(() => ({
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ run: vi.fn() })),
    })),
  })),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { publishDraft, retryGitPush } from '@/modules/knowledge/publisher';
import type { PublishInput } from '@/modules/knowledge/publisher';
import * as fs from 'fs';
import { execSync, spawn } from 'child_process';
import * as knowledgeRepo from '@/modules/knowledge/repository';
import * as jobsRepo from '@/modules/jobs/repository';
import * as wikiIndex from '@/modules/knowledge/wiki-index';
import * as frontMatter from '@/modules/knowledge/front-matter';
import { env } from '@/config/env';
import { AppError } from '@/lib/errors';

// ---------------------------------------------------------------------------
// Typed mock references
// ---------------------------------------------------------------------------

const mockMkdirSync = vi.mocked(fs.mkdirSync);
const mockOpenSync = vi.mocked(fs.openSync);
const mockWriteSync = vi.mocked(fs.writeSync);
const mockFsyncSync = vi.mocked(fs.fsyncSync);
const mockCloseSync = vi.mocked(fs.closeSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockCopyFileSync = vi.mocked(fs.copyFileSync);
const mockRenameSync = vi.mocked(fs.renameSync);
const mockUnlinkSync = vi.mocked(fs.unlinkSync);

const mockExecSync = vi.mocked(execSync);
const mockSpawn = vi.mocked(spawn);

const mockParseFrontMatter = vi.mocked(frontMatter.parseFrontMatter);
const mockGenerateWikiPath = vi.mocked(frontMatter.generateWikiPath);
const mockRebuildIndex = vi.mocked(wikiIndex.rebuildIndex);
const mockWriteIndex = vi.mocked(wikiIndex.writeIndex);

const mockUpdateJobStatus = vi.mocked(jobsRepo.updateJobStatus);
const mockGetJob = vi.mocked(jobsRepo.getJob);

const mockGetItemByWikiPath = vi.mocked(knowledgeRepo.getItemByWikiPath);
const mockGetItem = vi.mocked(knowledgeRepo.getItem);
const mockCreateItem = vi.mocked(knowledgeRepo.createItem);
const mockUpdateItem = vi.mocked(knowledgeRepo.updateItem);
const mockUpdateSyncStatus = vi.mocked(knowledgeRepo.updateSyncStatus);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WIKI_ROOT = '/data/md-wiki';
const FIXED_ID = 'id-00000000-0000-0000-0000-000000000001';
const SAMPLE_DRAFT_ID = 'draft-abc';
const SAMPLE_JOB_ID = 'job-xyz';
const SAMPLE_REVIEWER = 'user-reviewer';
const SAMPLE_CONTENT = '---\ntitle: Test\n---\n\nBody';

function makeInput(overrides?: Partial<PublishInput>): PublishInput {
  return {
    draftId: SAMPLE_DRAFT_ID,
    jobId: SAMPLE_JOB_ID,
    draftContent: SAMPLE_CONTENT,
    reviewedBy: SAMPLE_REVIEWER,
    ...overrides,
  };
}

/** Reset all mocks (implementations + history) and setup defaults for a successful publish. */
function setupHappyMocks() {
  // env defaults
  (env as any).WIKI_ROOT = WIKI_ROOT;
  (env as any).WIKI_GIT_REMOTE = 'origin';
  (env as any).WIKI_GIT_BRANCH = 'main';

  // fs defaults
  mockOpenSync.mockReturnValue(10 as any);
  mockWriteSync.mockReturnValue(0 as any);
  mockReadFileSync.mockReturnValue(SAMPLE_CONTENT);
  mockExistsSync.mockReturnValue(false);

  // child_process — git commit + rev-parse succeed
  mockExecSync.mockImplementation((cmd: string) => {
    if (typeof cmd === 'string' && cmd.includes('rev-parse')) {
      return Buffer.from('abc123sha\n');
    }
    return Buffer.from('');
  });
  mockSpawn.mockReturnValue({ on: vi.fn() } as any);

  // repos
  mockUpdateJobStatus.mockReturnValue(true);
  mockGetJob.mockReturnValue({ sourceId: 'src-001' } as any);
  mockGetItemByWikiPath.mockReturnValue(null);
  mockCreateItem.mockReturnValue({ id: FIXED_ID } as any);
}

// ---------------------------------------------------------------------------
// publishDraft
// ---------------------------------------------------------------------------

describe('publishDraft', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyMocks();
  });

  it('happy path — all 8 steps succeed, returns PublishResult', async () => {
    const result = await publishDraft(makeInput());

    expect(result).toEqual({
      itemId: FIXED_ID,
      wikiPath: 'basics/getting-started/test.md',
      gitCommitSha: 'abc123sha',
      wikiSyncStatus: 'pushed',
    });

    // Step 1: CAS pending_review -> publishing
    expect(mockUpdateJobStatus).toHaveBeenCalledWith(
      SAMPLE_JOB_ID,
      'pending_review',
      'publishing',
    );

    // Step 2: temp file written + fsync + close
    expect(mockOpenSync).toHaveBeenCalledWith(expect.stringContaining('.tmp'), 'w');
    expect(mockWriteSync).toHaveBeenCalled();
    expect(mockFsyncSync).toHaveBeenCalled();
    expect(mockCloseSync).toHaveBeenCalled();

    // Step 3: verify temp file parsed (called twice: once for input, once for verify)
    expect(mockParseFrontMatter).toHaveBeenCalledTimes(2);

    // Step 5: rename
    expect(mockRenameSync).toHaveBeenCalled();

    // Step 6: rebuildIndex + writeIndex
    expect(mockRebuildIndex).toHaveBeenCalledWith(WIKI_ROOT);
    expect(mockWriteIndex).toHaveBeenCalledWith(WIKI_ROOT, '# Knowledge Index\n');

    // Step 7: createItem (new item)
    expect(mockCreateItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Test',
        wikiPath: 'basics/getting-started/test.md',
        status: 'published',
      }),
    );

    // Step 7: job published
    expect(mockUpdateJobStatus).toHaveBeenCalledWith(
      SAMPLE_JOB_ID,
      'publishing',
      'published',
    );

    // Step 8: git add + commit
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('git add'),
      expect.objectContaining({ cwd: WIKI_ROOT }),
    );
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('git commit'),
      expect.objectContaining({ cwd: WIKI_ROOT }),
    );

    // Step 8: async push spawned
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['push', 'origin', 'main'],
      expect.objectContaining({ cwd: WIKI_ROOT, detached: true }),
    );

    // updateSyncStatus called with final status
    expect(mockUpdateSyncStatus).toHaveBeenCalledWith(FIXED_ID, 'pushed', 'abc123sha');
  });

  it('CAS failure — job not in pending_review -> throws AppError', async () => {
    mockUpdateJobStatus.mockReturnValue(false);

    await expect(publishDraft(makeInput())).rejects.toThrow(AppError);
    await expect(publishDraft(makeInput())).rejects.toThrow(
      'Job is not in pending_review state',
    );

    // No fs operations should have happened
    expect(mockOpenSync).not.toHaveBeenCalled();
  });

  it('temp file write fails -> rolls back job status', async () => {
    mockOpenSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    await expect(publishDraft(makeInput())).rejects.toThrow('EACCES');

    // Job rolled back
    expect(mockUpdateJobStatus).toHaveBeenCalledWith(
      SAMPLE_JOB_ID,
      'publishing',
      'pending_review',
    );

    // createItem NOT called
    expect(mockCreateItem).not.toHaveBeenCalled();
  });

  it('Front Matter verify fails -> restores backup + rolls back job', async () => {
    // Target file exists (backup will be created)
    mockExistsSync.mockImplementation((p: any) => {
      const s = p.toString();
      return s.endsWith('test.md') || s.endsWith('.bak');
    });

    // Make parseFrontMatter fail on second call (verify step)
    let callCount = 0;
    mockParseFrontMatter.mockImplementation((text: string) => {
      callCount++;
      if (callCount === 1) {
        return {
          frontMatter: {
            title: 'Test',
            category: 'basics',
            subcategory: 'getting-started',
            tags: [],
          } as any,
          body: 'Body',
        };
      }
      throw new AppError('DRAFT_INVALID', 'Invalid front matter');
    });

    await expect(publishDraft(makeInput())).rejects.toThrow('Invalid front matter');

    // Backup restored
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.bak'),
      expect.stringContaining('test.md'),
    );

    // Job rolled back
    expect(mockUpdateJobStatus).toHaveBeenCalledWith(
      SAMPLE_JOB_ID,
      'publishing',
      'pending_review',
    );
  });

  it('backup restore — target exists, .bak created, failure restores from .bak', async () => {
    // Target exists
    mockExistsSync.mockImplementation((p: any) => {
      const s = p.toString();
      return s.endsWith('test.md') || s.endsWith('.bak');
    });

    // Make renameSync throw (step 5 fails after backup in step 4)
    mockRenameSync.mockImplementation(() => {
      throw new Error('EXDEV: cross-device link');
    });

    await expect(publishDraft(makeInput())).rejects.toThrow('EXDEV');

    // Backup restored
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.bak'),
      expect.stringContaining('test.md'),
    );

    // Job rolled back
    expect(mockUpdateJobStatus).toHaveBeenCalledWith(
      SAMPLE_JOB_ID,
      'publishing',
      'pending_review',
    );
  });

  it('git commit succeeds + rev-parse fails -> wikiSyncStatus=push_failed', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('git add')) return Buffer.from('');
      if (typeof cmd === 'string' && cmd.includes('git commit')) return Buffer.from('');
      if (typeof cmd === 'string' && cmd.includes('rev-parse')) {
        throw new Error('git not available');
      }
      return Buffer.from('');
    });

    const result = await publishDraft(makeInput());

    expect(result.wikiSyncStatus).toBe('push_failed');
    expect(result.gitCommitSha).toBeNull();
    expect(mockCreateItem).toHaveBeenCalled();
    expect(mockUpdateSyncStatus).toHaveBeenCalledWith(FIXED_ID, 'push_failed', undefined);
  });

  it('git completely unavailable -> knowledge still published, wikiSyncStatus=push_failed', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('git not found');
    });

    const result = await publishDraft(makeInput());

    expect(result.wikiSyncStatus).toBe('push_failed');
    expect(result.gitCommitSha).toBeNull();
    expect(mockCreateItem).toHaveBeenCalled();
  });

  it('overwrite scenario — existing item updated via updateItem', async () => {
    const existingItem = {
      id: 'existing-item-id',
      wikiPath: 'basics/getting-started/test.md',
      title: 'Old Title',
    };
    mockGetItemByWikiPath.mockReturnValue(existingItem as any);

    const result = await publishDraft(makeInput());

    expect(result.itemId).toBe('existing-item-id');
    expect(mockUpdateItem).toHaveBeenCalledWith(
      'existing-item-id',
      expect.objectContaining({ title: 'Test' }),
    );
    expect(mockCreateItem).not.toHaveBeenCalled();
  });

  it('no WIKI_GIT_REMOTE -> wikiSyncStatus=committed, no push spawned', async () => {
    (env as any).WIKI_GIT_REMOTE = undefined;

    const result = await publishDraft(makeInput());

    expect(result.wikiSyncStatus).toBe('committed');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('finally block always cleans up .bak file on success', async () => {
    // Target exists so .bak gets created
    mockExistsSync.mockImplementation((p: any) => {
      const s = p.toString();
      return s.endsWith('test.md') || s.endsWith('.bak');
    });

    await publishDraft(makeInput());

    // finally block should unlink .bak
    expect(mockUnlinkSync).toHaveBeenCalledWith(expect.stringContaining('.bak'));
  });
});

// ---------------------------------------------------------------------------
// retryGitPush
// ---------------------------------------------------------------------------

describe('retryGitPush', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-setup env for retryGitPush tests
    (env as any).WIKI_ROOT = WIKI_ROOT;
    (env as any).WIKI_GIT_REMOTE = 'origin';
    (env as any).WIKI_GIT_BRANCH = 'main';
  });

  it('push_failed item -> push succeeds -> updates to pushed', async () => {
    mockGetItem.mockReturnValue({
      id: 'item-1',
      wikiSyncStatus: 'push_failed',
      gitCommitSha: 'sha-abc',
    } as any);
    mockExecSync.mockReturnValue(Buffer.from(''));

    await retryGitPush('item-1');

    expect(mockExecSync).toHaveBeenCalledWith(
      'git push origin main',
      expect.objectContaining({ cwd: WIKI_ROOT }),
    );
    expect(mockUpdateSyncStatus).toHaveBeenCalledWith('item-1', 'pushed', 'sha-abc');
  });

  it('non push_failed item -> throws AppError', async () => {
    mockGetItem.mockReturnValue({
      id: 'item-2',
      wikiSyncStatus: 'pushed',
      gitCommitSha: 'sha-abc',
    } as any);

    await expect(retryGitPush('item-2')).rejects.toThrow(AppError);
    await expect(retryGitPush('item-2')).rejects.toThrow(
      'Item is not in push_failed state',
    );
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('item not found -> throws AppError', async () => {
    mockGetItem.mockReturnValue(null);

    await expect(retryGitPush('nonexistent')).rejects.toThrow(AppError);
  });

  it('push still fails -> keeps push_failed (no updateSyncStatus call)', async () => {
    mockGetItem.mockReturnValue({
      id: 'item-3',
      wikiSyncStatus: 'push_failed',
      gitCommitSha: 'sha-xyz',
    } as any);
    mockExecSync.mockImplementation(() => {
      throw new Error('push failed');
    });

    await retryGitPush('item-3');

    expect(mockUpdateSyncStatus).not.toHaveBeenCalled();
  });
});
