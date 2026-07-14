import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

const { testEnv } = vi.hoisted(() => ({
  testEnv: {
    WIKI_ROOT: '',
    WIKI_GIT_REMOTE: undefined as string | undefined,
    WIKI_GIT_BRANCH: 'main',
  },
}));

vi.mock('@/config/env', () => ({ env: testEnv }));
vi.mock('@/modules/knowledge-evaluation/repository', () => ({
  getPublishGuardSettings: () => ({ enabled: false, minScore: 60 }),
  getEvaluationByDraftId: () => null,
}));
vi.mock('@/modules/jobs/repository', () => ({
  updateJobStatus: vi.fn(() => true),
  getJob: vi.fn(() => ({ sourceId: 'source-001' })),
}));
vi.mock('@/modules/knowledge/repository', () => ({
  commitPublishedDraft: vi.fn(() => ({ itemId: 'item-001' })),
  getItemByWikiPath: vi.fn(() => null),
  createItem: vi.fn(() => ({ id: 'item-001' })),
  updateItem: vi.fn(),
  supersedeOldDrafts: vi.fn(),
  updateDraft: vi.fn(),
  updateSyncStatus: vi.fn(),
}));
vi.mock('@/db/client', () => ({
  getDb: () => ({
    insert: () => ({ values: () => ({ run: () => undefined }) }),
  }),
}));

import { publishDraft } from '@/modules/knowledge/publisher';
import * as knowledgeRepo from '@/modules/knowledge/repository';

describe('publisher Git command integration', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'knowledge-publisher-'));
    testEnv.WIKI_ROOT = join(tempRoot, 'wiki');
    testEnv.WIKI_GIT_REMOTE = undefined;
    execFileSync('git', ['init', testEnv.WIKI_ROOT]);
    execFileSync('git', ['config', 'user.email', 'publisher-test@example.invalid'], {
      cwd: testEnv.WIKI_ROOT,
    });
    execFileSync('git', ['config', 'user.name', 'Publisher Test'], {
      cwd: testEnv.WIKI_ROOT,
    });
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('does not create a sentinel from shell syntax in a literal commit title', async () => {
    const sentinel = join(tempRoot, 'sentinel');
    const title = `--$(touch ${sentinel}) \`printf backtick\` "quoted"`;
    const draftContent = [
      '---',
      `title: ${title}`,
      'category: basics',
      'subcategory: getting-started',
      'tags: [security]',
      '---',
      '',
      'Body',
    ].join('\n');

    await publishDraft({
      draftId: 'draft-security',
      jobId: 'job-security',
      draftContent,
      reviewedBy: 'reviewer-security',
    });

    expect(existsSync(sentinel)).toBe(false);
    const message = execFileSync('git', ['log', '-1', '--pretty=%B'], {
      cwd: testEnv.WIKI_ROOT,
      encoding: 'utf8',
    }).trim();
    expect(message).toBe(`knowledge: ${title} [draft-security]`);
  });

  it('rebuilds index without the reverted target when the DB transaction fails', async () => {
    vi.mocked(knowledgeRepo.commitPublishedDraft).mockImplementationOnce(() => {
      throw new Error('audit insert failed');
    });
    const title = 'Rolled Back Entry';
    const draftContent = [
      '---',
      `title: ${title}`,
      'category: basics',
      'subcategory: getting-started',
      'tags: [rollback]',
      '---',
      '',
      'Body',
    ].join('\n');

    await expect(
      publishDraft({
        draftId: 'draft-rollback',
        jobId: 'job-rollback',
        draftContent,
        reviewedBy: 'reviewer-rollback',
      }),
    ).rejects.toThrow('audit insert failed');

    const index = execFileSync('git', ['status', '--short'], {
      cwd: testEnv.WIKI_ROOT,
      encoding: 'utf8',
    });
    expect(index).not.toContain('rolled-back-entry.md');
    expect(existsSync(join(testEnv.WIKI_ROOT, 'basics/getting-started/rolled-back-entry.md'))).toBe(
      false,
    );
    expect(readFileSync(join(testEnv.WIKI_ROOT, 'index.md'), 'utf8')).not.toContain(title);
  });
});
