import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  openSync: vi.fn(() => 10),
  writeSync: vi.fn(() => 0),
  writeFileSync: vi.fn(),
  fsyncSync: vi.fn(),
  closeSync: vi.fn(),
  readFileSync: vi.fn(() => '---\ntitle: Test\n---\n\nBody'),
  existsSync: vi.fn(() => false),
  copyFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('child_process', () => {
  const execSync = vi.fn(() => Buffer.from('abc123sha\n'));
  const execFileSync = vi.fn((_file: string, args: string[]) =>
    args[0] === 'rev-parse' ? Buffer.from('abc123sha\n') : Buffer.from(''),
  );
  const spawn = vi.fn();
  return {
    default: { execSync, execFileSync, spawn },
    execSync,
    execFileSync,
    spawn,
  };
});

vi.mock('@/modules/knowledge/wiki-index', () => ({
  rebuildIndex: vi.fn(() => '# Knowledge Index\n'),
  writeIndex: vi.fn(),
}));

vi.mock('@/modules/knowledge/front-matter', () => ({
  assertTrustedSourceMetadata: vi.fn(),
  parseFrontMatter: vi.fn(() => ({
    frontMatter: {
      id: 'source-001',
      title: 'Test',
      description: 'Test description',
      category: 'getting-started',
      subcategory: 'first-race',
      tags: ['test'],
      aliases: [],
      source_id: 'source-001',
      source_sha256: 'a'.repeat(64),
    },
    body: 'Body',
  })),
  generateWikiPath: vi.fn(() => 'getting-started/first-race/test.md'),
}));

vi.mock('@/modules/knowledge/repository', () => ({
  getSource: vi.fn(() => ({ id: 'source-001', sha256: 'a'.repeat(64) })),
  commitPublishedDraft: vi.fn(() => ({ itemId: 'item-001' })),
  completePushAttempt: vi.fn(() => true),
  getItemByWikiPath: vi.fn(() => null),
  getItem: vi.fn(() => null),
  createItem: vi.fn(() => ({ id: 'item-001' })),
  updateItem: vi.fn(),
  updateSyncStatus: vi.fn(),
  supersedeOldDrafts: vi.fn(),
  updateDraft: vi.fn(),
}));

vi.mock('@/modules/jobs/repository', () => ({
  updateJobStatus: vi.fn(() => true),
  getJob: vi.fn(() => ({ sourceId: 'source-001' })),
}));

vi.mock('@/modules/knowledge-evaluation/repository', () => ({
  getPublishGuardSettings: vi.fn(() => ({ enabled: false, minScore: 60 })),
  getEvaluationByDraftId: vi.fn(() => null),
}));

vi.mock('@/config/env', () => ({
  env: {
    WIKI_ROOT: '/data/md-wiki',
    WIKI_GIT_REMOTE: 'origin',
    WIKI_GIT_BRANCH: 'main',
  },
}));

vi.mock('@/lib/uuid', () => ({
  generateId: vi.fn(() => 'id-001'),
}));

vi.mock('@/lib/datetime', () => ({
  utcNow: vi.fn(() => '2026-07-12T00:00:00.000Z'),
}));

vi.mock('@/db/client', () => ({
  getDb: vi.fn(() => ({
    insert: vi.fn(() => ({ values: vi.fn(() => ({ run: vi.fn() })) })),
  })),
}));

import { publishDraft, retryGitPush } from '@/modules/knowledge/publisher';
import type { PublishInput } from '@/modules/knowledge/publisher';
import * as fs from 'fs';
import { execFileSync, execSync, spawn } from 'child_process';
import * as knowledgeRepo from '@/modules/knowledge/repository';
import * as jobsRepo from '@/modules/jobs/repository';
import * as frontMatter from '@/modules/knowledge/front-matter';
import * as wikiIndex from '@/modules/knowledge/wiki-index';
import { env } from '@/config/env';
import { AppError } from '@/lib/errors';

const mockExecFileSync = vi.mocked(execFileSync);
const mockExecSync = vi.mocked(execSync);
const mockSpawn = vi.mocked(spawn);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockCopyFileSync = vi.mocked(fs.copyFileSync);
const mockMkdirSync = vi.mocked(fs.mkdirSync);
const mockOpenSync = vi.mocked(fs.openSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockRenameSync = vi.mocked(fs.renameSync);
const mockUnlinkSync = vi.mocked(fs.unlinkSync);
const mockParseFrontMatter = vi.mocked(frontMatter.parseFrontMatter);
const mockGenerateWikiPath = vi.mocked(frontMatter.generateWikiPath);
const mockUpdateJobStatus = vi.mocked(jobsRepo.updateJobStatus);
const mockGetJob = vi.mocked(jobsRepo.getJob);
const mockCommitPublishedDraft = vi.mocked(knowledgeRepo.commitPublishedDraft);
const mockCompletePushAttempt = vi.mocked(knowledgeRepo.completePushAttempt);
const mockGetItem = vi.mocked(knowledgeRepo.getItem);
const mockUpdateSyncStatus = vi.mocked(knowledgeRepo.updateSyncStatus);
const mockRebuildIndex = vi.mocked(wikiIndex.rebuildIndex);
const mockWriteIndex = vi.mocked(wikiIndex.writeIndex);

const WIKI_ROOT = '/data/md-wiki';
const SAMPLE_DRAFT_ID = 'draft-abc';
const SAMPLE_JOB_ID = 'job-xyz';
const SAMPLE_REVIEWER = 'user-reviewer';
const SAMPLE_CONTENT = '---\ntitle: Test\n---\n\nBody';

type MockChild = { on: ReturnType<typeof vi.fn>; unref: ReturnType<typeof vi.fn> };
let child: MockChild;

function makeInput(overrides?: Partial<PublishInput>): PublishInput {
  return {
    draftId: SAMPLE_DRAFT_ID,
    jobId: SAMPLE_JOB_ID,
    draftContent: SAMPLE_CONTENT,
    reviewedBy: SAMPLE_REVIEWER,
    ...overrides,
  };
}

function emitChild(event: 'error' | 'exit', ...args: unknown[]): void {
  for (const [registeredEvent, listener] of child.on.mock.calls) {
    if (registeredEvent === event) listener(...args);
  }
}

function setupHappyMocks(): void {
  (env as any).WIKI_ROOT = WIKI_ROOT;
  (env as any).WIKI_GIT_REMOTE = 'origin';
  (env as any).WIKI_GIT_BRANCH = 'main';
  mockOpenSync.mockReturnValue(10 as any);
  mockReadFileSync.mockReturnValue(SAMPLE_CONTENT);
  mockExistsSync.mockReturnValue(false);
  mockParseFrontMatter.mockReturnValue({
    frontMatter: {
      id: 'source-001',
      title: 'Test',
      description: 'Test description',
      category: 'getting-started',
      subcategory: 'first-race',
      tags: ['test'],
      aliases: [],
      source_id: 'source-001',
      source_sha256: 'a'.repeat(64),
    },
    body: 'Body',
  });
  mockGenerateWikiPath.mockReturnValue('getting-started/first-race/test.md');
  mockExecFileSync.mockImplementation((_file: string, args?: readonly string[]) =>
    args?.[0] === 'rev-parse' ? Buffer.from('abc123sha\n') : Buffer.from(''),
  );
  mockExecSync.mockReturnValue(Buffer.from('abc123sha\n'));
  child = { on: vi.fn().mockReturnThis(), unref: vi.fn() };
  mockSpawn.mockReturnValue(child as any);
  mockUpdateJobStatus.mockReturnValue(true);
  mockGetJob.mockReturnValue({ sourceId: 'source-001' } as any);
  mockCommitPublishedDraft.mockReturnValue({ itemId: 'item-001' });
}

describe('publishDraft', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyMocks();
  });

  it('uses argv for every Git command and treats a malicious title as literal data', async () => {
    const maliciousTitle =
      '--$(touch /tmp/publisher-sentinel) `touch /tmp/backtick` "quoted"\nnext';
    mockParseFrontMatter.mockReturnValue({
      frontMatter: {
        id: 'source-001',
        title: maliciousTitle,
        description: 'Test description',
        category: 'getting-started',
        subcategory: 'first-race',
        tags: [],
        aliases: [],
        source_id: 'source-001',
        source_sha256: 'a'.repeat(64),
      },
      body: 'Body',
    });

    await publishDraft(makeInput());

    expect(mockExecSync).not.toHaveBeenCalled();
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      1,
      'git',
      ['add', '--', 'getting-started/first-race/test.md', 'index.md', 'KNOWLEDGE.md'],
      expect.objectContaining({ cwd: WIKI_ROOT }),
    );
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      2,
      'git',
      ['commit', '-m', `knowledge: ${maliciousTitle} [${SAMPLE_DRAFT_ID}]`],
      expect.objectContaining({ cwd: WIKI_ROOT }),
    );
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      3,
      'git',
      ['rev-parse', 'HEAD'],
      expect.objectContaining({ cwd: WIKI_ROOT }),
    );
  });

  it('persists push_pending before spawn and only marks synced after exit 0', async () => {
    const result = await publishDraft(makeInput());

    expect(result).toEqual({
      itemId: 'item-001',
      wikiPath: 'getting-started/first-race/test.md',
      gitCommitSha: 'abc123sha',
      wikiSyncStatus: 'push_pending',
    });
    expect(mockUpdateSyncStatus).toHaveBeenCalledWith('item-001', 'push_pending', 'abc123sha');
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['push', 'origin', 'main'],
      expect.objectContaining({ cwd: WIKI_ROOT, stdio: 'ignore' }),
    );
    expect(mockUpdateSyncStatus).not.toHaveBeenCalledWith('item-001', 'synced', 'abc123sha');

    emitChild('exit', 0, null);

    expect(mockCompletePushAttempt).toHaveBeenCalledWith('item-001', 'abc123sha', 'synced');
  });

  it('push exit failure retains the published file/job and marks push_failed', async () => {
    const result = await publishDraft(makeInput());
    mockUnlinkSync.mockClear();

    emitChild('exit', 1, null);

    expect(result.wikiSyncStatus).toBe('push_pending');
    expect(mockCompletePushAttempt).toHaveBeenCalledWith('item-001', 'abc123sha', 'push_failed');
    expect(mockUpdateJobStatus).not.toHaveBeenCalledWith(
      SAMPLE_JOB_ID,
      'publishing',
      'pending_review',
    );
    expect(mockUnlinkSync).not.toHaveBeenCalledWith(
      '/data/md-wiki/getting-started/first-race/test.md',
    );
  });

  it('push start failure retains published state/file and returns push_failed', async () => {
    mockSpawn.mockImplementation(() => {
      throw new Error('spawn failed');
    });

    const result = await publishDraft(makeInput());

    expect(result.wikiSyncStatus).toBe('push_failed');
    expect(mockCompletePushAttempt).toHaveBeenCalledWith('item-001', 'abc123sha', 'push_failed');
    expect(mockUpdateJobStatus).not.toHaveBeenCalledWith(
      SAMPLE_JOB_ID,
      'publishing',
      'pending_review',
    );
    expect(mockUnlinkSync).not.toHaveBeenCalledWith(
      '/data/md-wiki/getting-started/first-race/test.md',
    );
  });

  it('without a remote leaves the committed status and does not spawn push', async () => {
    (env as any).WIKI_GIT_REMOTE = undefined;

    const result = await publishDraft(makeInput());

    expect(result.wikiSyncStatus).toBe('committed');
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockUpdateSyncStatus).toHaveBeenLastCalledWith('item-001', 'committed', 'abc123sha');
  });

  it('Git commit failure is non-blocking and cannot roll back published DB/file state', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('git unavailable');
    });

    const result = await publishDraft(makeInput());

    expect(result.wikiSyncStatus).toBe('push_failed');
    expect(mockCommitPublishedDraft).toHaveBeenCalled();
    expect(mockUpdateJobStatus).not.toHaveBeenCalledWith(
      SAMPLE_JOB_ID,
      'publishing',
      'pending_review',
    );
    expect(mockUnlinkSync).not.toHaveBeenCalledWith(
      '/data/md-wiki/getting-started/first-race/test.md',
    );
  });

  it('rejects a generated path outside WIKI_ROOT before writing any file', async () => {
    mockGenerateWikiPath.mockReturnValue('../../publisher-sentinel.md');

    await expect(publishDraft(makeInput())).rejects.toThrow(AppError);
    await expect(publishDraft(makeInput())).rejects.toThrow('outside the Wiki root');

    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockUpdateJobStatus).not.toHaveBeenCalled();
  });

  it('pre-publish file failure restores backup and rolls job back', async () => {
    mockExistsSync.mockImplementation((value: fs.PathLike) => {
      const file = value.toString();
      return file.endsWith('test.md') || file.endsWith('.bak');
    });
    mockRenameSync.mockImplementation(() => {
      throw new Error('rename failed');
    });

    await expect(publishDraft(makeInput())).rejects.toThrow('rename failed');

    expect(mockCopyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.bak'),
      expect.stringContaining('test.md'),
    );
    expect(mockUpdateJobStatus).toHaveBeenCalledWith(SAMPLE_JOB_ID, 'publishing', 'pending_review');
  });

  it('rebuilds index after a DB transaction failure restores the target file', async () => {
    mockExistsSync.mockImplementation((value: fs.PathLike) => {
      const file = value.toString();
      return file.endsWith('test.md') || file.endsWith('.bak');
    });
    mockRebuildIndex
      .mockReturnValueOnce('# stale index\n')
      .mockReturnValueOnce('# restored index\n');
    mockCommitPublishedDraft.mockImplementation(() => {
      throw new Error('audit insert failed');
    });

    await expect(publishDraft(makeInput())).rejects.toThrow('audit insert failed');

    expect(mockRebuildIndex).toHaveBeenCalledTimes(2);
    expect(mockWriteIndex).toHaveBeenNthCalledWith(2, WIKI_ROOT, '# restored index\n');
  });

  it('settles an async child error once even if exit follows', async () => {
    await publishDraft(makeInput());

    emitChild('error', new Error('ENOENT'));
    emitChild('exit', 1, null);

    expect(mockCompletePushAttempt).toHaveBeenCalledTimes(1);
    expect(mockCompletePushAttempt).toHaveBeenCalledWith('item-001', 'abc123sha', 'push_failed');
  });

  it('CAS failure does not touch the filesystem', async () => {
    mockUpdateJobStatus.mockReturnValue(false);

    await expect(publishDraft(makeInput())).rejects.toThrow('Job is not in pending_review state');
    expect(mockOpenSync).not.toHaveBeenCalled();
  });
});

describe('retryGitPush', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyMocks();
  });

  it('uses argv and writes synced only after confirmed success', async () => {
    mockGetItem.mockReturnValue({
      id: 'item-1',
      wikiSyncStatus: 'push_failed',
      gitCommitSha: 'sha-abc',
    } as any);

    await retryGitPush('item-1');

    expect(mockExecSync).not.toHaveBeenCalled();
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['push', 'origin', 'main'],
      expect.objectContaining({ cwd: WIKI_ROOT }),
    );
    expect(mockUpdateSyncStatus).toHaveBeenCalledWith('item-1', 'push_pending', 'sha-abc');
    expect(mockCompletePushAttempt).toHaveBeenCalledWith('item-1', 'sha-abc', 'synced');
  });

  it('failed retry remains push_failed', async () => {
    mockGetItem.mockReturnValue({
      id: 'item-2',
      wikiSyncStatus: 'push_failed',
      gitCommitSha: 'sha-def',
    } as any);
    mockExecFileSync.mockImplementation(() => {
      throw new Error('push failed');
    });

    await retryGitPush('item-2');

    expect(mockUpdateSyncStatus).toHaveBeenCalledWith('item-2', 'push_pending', 'sha-def');
    expect(mockCompletePushAttempt).toHaveBeenCalledWith('item-2', 'sha-def', 'push_failed');
  });

  it('recovers a failed publication commit before retrying push', async () => {
    mockExecFileSync.mockImplementation((_file: string, args?: readonly string[]) => {
      if (args?.[0] === 'commit') throw new Error('commit failed');
      return Buffer.from('');
    });

    const failedPublication = await publishDraft(makeInput());

    expect(failedPublication).toMatchObject({
      itemId: 'item-001',
      gitCommitSha: null,
      wikiSyncStatus: 'push_failed',
    });
    mockGetItem.mockReturnValue({
      id: 'item-4',
      draftId: 'draft-4',
      title: 'Recovered Commit',
      wikiPath: 'basics/getting-started/recovered.md',
      wikiSyncStatus: 'push_failed',
      gitCommitSha: null,
    } as any);
    mockExecFileSync.mockClear();
    mockExecFileSync.mockImplementation((_file: string, args?: readonly string[]) =>
      args?.[0] === 'rev-parse' ? Buffer.from('recovered-sha\n') : Buffer.from(''),
    );

    await retryGitPush('item-4');

    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      1,
      'git',
      ['add', '--', 'basics/getting-started/recovered.md', 'index.md', 'KNOWLEDGE.md'],
      expect.objectContaining({ cwd: WIKI_ROOT }),
    );
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      2,
      'git',
      ['commit', '-m', 'knowledge: Recovered Commit [draft-4]'],
      expect.objectContaining({ cwd: WIKI_ROOT }),
    );
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      4,
      'git',
      ['push', 'origin', 'main'],
      expect.objectContaining({ cwd: WIKI_ROOT }),
    );
    expect(mockCompletePushAttempt).toHaveBeenCalledWith('item-4', 'recovered-sha', 'synced');
  });

  it('rejects an item not in push_failed', async () => {
    mockGetItem.mockReturnValue({ id: 'item-3', wikiSyncStatus: 'committed' } as any);

    await expect(retryGitPush('item-3')).rejects.toThrow(AppError);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });
});
