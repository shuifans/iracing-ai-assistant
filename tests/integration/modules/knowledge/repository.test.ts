/**
 * Knowledge repository integration tests.
 *
 * Uses createTestDb() — real in-memory SQLite + Drizzle.
 * Verifies 4-table CRUD: sources, drafts, items, jobs interactions.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { TestDb } from '../../../helpers/test-db';
import { makeUser, makeKnowledgeSource, makeKnowledgeJob, makeKnowledgeDraft, makeKnowledgeItem } from '../../../helpers/fixtures';
import { users } from '@/db/schema/users';
import { knowledgeSources, knowledgeJobs, knowledgeDrafts, knowledgeItems } from '@/db/schema/knowledge';
import { utcNow } from '@/lib/datetime';

// ── Skip if native module unavailable ────────────────────────────────────────
let canLoadNative = true;
try {
  const Database = require('better-sqlite3');
  const probe = new Database(':memory:');
  probe.close();
} catch {
  canLoadNative = false;
}

// ── Env stubs (must be set before any repository import) ─────────────────────
const ENV_DEFAULTS: Record<string, string> = {
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: 'test-secret-access-key-minimum-length',
  REFRESH_TOKEN_PEPPER: 'test-refresh-pepper',
  IP_HASH_PEPPER: 'test-ip-hash-pepper',
  QODER_PERSONAL_ACCESS_TOKEN: 'test-pat-token',
  KNOWLEDGE_JOB_LEASE_SECONDS: '300',
  DATABASE_PATH: ':memory:',
  WIKI_ROOT: '/tmp/wiki',
};

for (const [k, v] of Object.entries(ENV_DEFAULTS)) {
  if (!process.env[k]) process.env[k] = v;
}

// ── Shared db reference — assigned in beforeAll, read by mock factory ────────
let dbRef: TestDb | null = null;

vi.mock('@/db/client', () => ({
  getDb: () => dbRef!,
  getRawDb: () => null,
  closeDb: () => {},
  resetDbForTesting: () => {},
}));

describe.skipIf(!canLoadNative)('knowledge/repository integration', () => {
  let db: TestDb;
  let cleanup: () => void;
  let userId: string;

  // Repository functions (lazy-loaded after mocks)
  let createSource: typeof import('@/modules/knowledge/repository').createSource;
  let getSource: typeof import('@/modules/knowledge/repository').getSource;
  let listSources: typeof import('@/modules/knowledge/repository').listSources;
  let findDuplicateBySha256: typeof import('@/modules/knowledge/repository').findDuplicateBySha256;
  let createDraft: typeof import('@/modules/knowledge/repository').createDraft;
  let getDraft: typeof import('@/modules/knowledge/repository').getDraft;
  let updateDraft: typeof import('@/modules/knowledge/repository').updateDraft;
  let supersedeOldDrafts: typeof import('@/modules/knowledge/repository').supersedeOldDrafts;
  let createItem: typeof import('@/modules/knowledge/repository').createItem;
  let getItem: typeof import('@/modules/knowledge/repository').getItem;
  let getItemByWikiPath: typeof import('@/modules/knowledge/repository').getItemByWikiPath;
  let listItems: typeof import('@/modules/knowledge/repository').listItems;
  let archiveItem: typeof import('@/modules/knowledge/repository').archiveItem;
  let restoreItem: typeof import('@/modules/knowledge/repository').restoreItem;
  let updateSyncStatus: typeof import('@/modules/knowledge/repository').updateSyncStatus;
  let updateItem: typeof import('@/modules/knowledge/repository').updateItem;

  beforeAll(async () => {
    const { createTestDb } = await import('../../../helpers/test-db');
    const result = createTestDb();
    db = result.db;
    dbRef = db;
    cleanup = result.cleanup;

    // Dynamically import the repository (after mocks are set up)
    const repo = await import('@/modules/knowledge/repository');
    createSource = repo.createSource;
    getSource = repo.getSource;
    listSources = repo.listSources;
    findDuplicateBySha256 = repo.findDuplicateBySha256;
    createDraft = repo.createDraft;
    getDraft = repo.getDraft;
    updateDraft = repo.updateDraft;
    supersedeOldDrafts = repo.supersedeOldDrafts;
    createItem = repo.createItem;
    getItem = repo.getItem;
    getItemByWikiPath = repo.getItemByWikiPath;
    listItems = repo.listItems;
    archiveItem = repo.archiveItem;
    restoreItem = repo.restoreItem;
    updateSyncStatus = repo.updateSyncStatus;
    updateItem = repo.updateItem;

    // Seed a user for FK constraints
    const user = makeUser();
    userId = user.id;
    db.insert(users).values(user).run();
  });

  afterAll(() => {
    cleanup?.();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    // Clean all knowledge tables before each test (items depend on drafts/jobs/sources)
    db.delete(knowledgeItems).run();
    db.delete(knowledgeDrafts).run();
    db.delete(knowledgeJobs).run();
    db.delete(knowledgeSources).run();
  });

  // ─── Sources ─────────────────────────────────────────────────────────────

  describe('Sources', () => {
    it('createSource → getSource returns correct record', () => {
      const src = createSource({
        inputType: 'file',
        originalName: 'test.txt',
        mimeType: 'text/plain',
        relativePath: 'uploads/test.txt',
        sha256: 'abc123def456',
        sizeBytes: 512,
        status: 'stored',
        submittedBy: userId,
      });

      expect(src.id).toBeTruthy();
      expect(src.createdAt).toBeTruthy();

      const fetched = getSource(src.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(src.id);
      expect(fetched!.sha256).toBe('abc123def456');
      expect(fetched!.status).toBe('stored');
      expect(fetched!.submittedBy).toBe(userId);
    });

    it('listSources cursor pagination', () => {
      for (let i = 0; i < 5; i++) {
        createSource({
          inputType: 'file',
          originalName: `file${i}.txt`,
          mimeType: 'text/plain',
          relativePath: `uploads/file${i}.txt`,
          sha256: `sha256-${i}`,
          sizeBytes: 100,
          status: 'stored',
          submittedBy: userId,
        });
      }

      const page1 = listSources({ limit: 3 });
      expect(page1.items).toHaveLength(3);
      expect(page1.nextCursor).toBeTruthy();

      const page2 = listSources({ limit: 3, cursor: page1.nextCursor! });
      expect(page2.items).toHaveLength(2);
      expect(page2.nextCursor).toBeNull();
    });

    it('findDuplicateBySha256 deduplication', () => {
      createSource({
        inputType: 'file',
        originalName: 'dup.txt',
        mimeType: 'text/plain',
        relativePath: 'uploads/dup.txt',
        sha256: 'duplicate-hash-123',
        sizeBytes: 200,
        status: 'stored',
        submittedBy: userId,
      });

      const dup = findDuplicateBySha256('duplicate-hash-123');
      expect(dup).not.toBeNull();
      expect(dup!.originalName).toBe('dup.txt');

      const noDup = findDuplicateBySha256('non-existent-hash');
      expect(noDup).toBeNull();
    });
  });

  // ─── Drafts ──────────────────────────────────────────────────────────────

  describe('Drafts', () => {
    let sourceId: string;
    let jobId: string;

    beforeEach(() => {
      // Need a source and a job for drafts
      const src = createSource({
        inputType: 'file',
        originalName: 'draft-src.txt',
        mimeType: 'text/plain',
        relativePath: 'uploads/draft-src.txt',
        sha256: 'draft-source-sha',
        sizeBytes: 300,
        status: 'stored',
        submittedBy: userId,
      });
      sourceId = src.id;

      const job = makeKnowledgeJob(sourceId);
      jobId = job.id;
      db.insert(knowledgeJobs).values(job).run();
    });

    it('createDraft → getDraft → updateDraft', () => {
      const draft = createDraft({
        jobId,
        suggestedPath: 'track-technique/braking/article.md',
        title: 'Braking Guide',
        frontMatterJson: JSON.stringify({ category: 'track-technique', subcategory: 'braking' }),
        draftRelativePath: 'drafts/braking.md',
        contentSha256: 'content-sha-1',
        status: 'pending_review',
      });

      expect(draft.id).toBeTruthy();

      const fetched = getDraft(draft.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.title).toBe('Braking Guide');
      expect(fetched!.status).toBe('pending_review');

      updateDraft(draft.id, { title: 'Updated Braking Guide', status: 'approved' });
      const updated = getDraft(draft.id);
      expect(updated!.title).toBe('Updated Braking Guide');
      expect(updated!.status).toBe('approved');
    });

    it('supersedeOldDrafts only affects other drafts', () => {
      // Create 2 jobs for the same source
      const job2 = makeKnowledgeJob(sourceId);
      db.insert(knowledgeJobs).values(job2).run();

      const draft1 = createDraft({
        jobId,
        suggestedPath: 'path1.md',
        title: 'Draft 1',
        frontMatterJson: '{}',
        draftRelativePath: 'd1.md',
        contentSha256: 'sha1',
        status: 'pending_review',
      });

      const draft2 = createDraft({
        jobId: job2.id,
        suggestedPath: 'path2.md',
        title: 'Draft 2',
        frontMatterJson: '{}',
        draftRelativePath: 'd2.md',
        contentSha256: 'sha2',
        status: 'pending_review',
      });

      // Supersede old drafts: draft2 is current, draft1 should be superseded
      supersedeOldDrafts(sourceId, draft2.id);

      const d1 = getDraft(draft1.id);
      const d2 = getDraft(draft2.id);
      expect(d1!.status).toBe('superseded');
      expect(d2!.status).toBe('pending_review'); // unchanged
    });
  });

  // ─── Items ───────────────────────────────────────────────────────────────

  describe('Items', () => {
    let sourceId: string;
    let draftId: string;

    beforeEach(() => {
      // Need source, job, and draft for items
      const src = createSource({
        inputType: 'file',
        originalName: 'item-src.txt',
        mimeType: 'text/plain',
        relativePath: 'uploads/item-src.txt',
        sha256: 'item-source-sha',
        sizeBytes: 400,
        status: 'stored',
        submittedBy: userId,
      });
      sourceId = src.id;

      const job = makeKnowledgeJob(sourceId);
      db.insert(knowledgeJobs).values(job).run();

      const draft = makeKnowledgeDraft(job.id);
      draftId = draft.id;
      db.insert(knowledgeDrafts).values(draft).run();
    });

    it('createItem → getItem → getItemByWikiPath', () => {
      const item = createItem({
        sourceId,
        draftId,
        title: 'Test Item',
        category: 'track-technique',
        subcategory: 'braking',
        tagsJson: JSON.stringify(['tag1']),
        sourceName: 'item-src.txt',
        sourceUrl: null,
        season: '2026-S1',
        wikiPath: 'track-technique/braking/test-item.md',
        status: 'published',
        gitCommitSha: null,
        wikiSyncStatus: 'committed',
        publishedBy: userId,
        publishedAt: utcNow(),
      });

      expect(item.id).toBeTruthy();

      const fetched = getItem(item.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.title).toBe('Test Item');
      expect(fetched!.wikiPath).toBe('track-technique/braking/test-item.md');

      const byPath = getItemByWikiPath('track-technique/braking/test-item.md');
      expect(byPath).not.toBeNull();
      expect(byPath!.id).toBe(item.id);
    });

    it('listItems cursor pagination + category/status filter', () => {
      for (let i = 0; i < 4; i++) {
        createItem({
          sourceId,
          draftId,
          title: `Item ${i}`,
          category: i < 2 ? 'track-technique' : 'car-setup',
          subcategory: i < 2 ? 'braking' : 'theory',
          tagsJson: '[]',
          sourceName: 'src.txt',
          sourceUrl: null,
          season: '2026-S1',
          wikiPath: `path/item-${i}.md`,
          status: 'published',
          gitCommitSha: null,
          wikiSyncStatus: 'committed',
          publishedBy: userId,
          publishedAt: utcNow(),
        });
      }

      const all = listItems({ limit: 10 });
      expect(all.items).toHaveLength(4);

      const technique = listItems({ limit: 10, category: 'track-technique' });
      expect(technique.items).toHaveLength(2);

      const page1 = listItems({ limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).toBeTruthy();
    });

    it('archiveItem → restoreItem status toggle', () => {
      const item = createItem({
        sourceId,
        draftId,
        title: 'Archive Test',
        category: 'basics',
        subcategory: 'getting-started',
        tagsJson: '[]',
        sourceName: 'src.txt',
        sourceUrl: null,
        season: '2026-S1',
        wikiPath: 'basics/getting-started/archive-test.md',
        status: 'published',
        gitCommitSha: null,
        wikiSyncStatus: 'committed',
        publishedBy: userId,
        publishedAt: utcNow(),
      });

      archiveItem(item.id);
      expect(getItem(item.id)!.status).toBe('archived');

      restoreItem(item.id);
      expect(getItem(item.id)!.status).toBe('published');
    });

    it('updateSyncStatus updates wiki sync status and commit sha', () => {
      const item = createItem({
        sourceId,
        draftId,
        title: 'Sync Test',
        category: 'basics',
        subcategory: 'getting-started',
        tagsJson: '[]',
        sourceName: 'src.txt',
        sourceUrl: null,
        season: '2026-S1',
        wikiPath: 'basics/getting-started/sync-test.md',
        status: 'published',
        gitCommitSha: null,
        wikiSyncStatus: 'committed',
        publishedBy: userId,
        publishedAt: utcNow(),
      });

      updateSyncStatus(item.id, 'synced', 'abc123commit');
      const updated = getItem(item.id);
      expect(updated!.wikiSyncStatus).toBe('synced');
      expect(updated!.gitCommitSha).toBe('abc123commit');
    });
  });
});
