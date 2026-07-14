import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB client and helpers before importing repository
vi.mock('@/db/client', () => ({
  getDb: vi.fn(),
}));

vi.mock('@/lib/uuid', () => ({
  generateId: vi.fn(() => 'test-uuid'),
}));

vi.mock('@/lib/datetime', () => ({
  utcNow: vi.fn(() => '2026-07-12T00:00:00.000Z'),
}));

// Create mock DB with chainable methods
const mockRun = vi.fn();
const mockAll = vi.fn();
const mockLimit = vi.fn();
const mockOrderBy = vi.fn();
const mockWhere = vi.fn();
const mockSet = vi.fn();
const mockValues = vi.fn();
const mockFrom = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockSelect = vi.fn();

function setupMockDb() {
  // Chain: select().from().where().limit() / .orderBy()
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ limit: mockLimit, orderBy: mockOrderBy, run: mockRun, all: mockAll });
  mockLimit.mockReturnValue({ all: mockAll, run: mockRun });
  mockAll.mockReturnValue([]);
  mockOrderBy.mockReturnValue({ limit: mockLimit, all: mockAll });

  // Chain: insert().values().run()
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ run: mockRun });

  // Chain: update().set().where().run()
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockWhere, run: mockRun });

  // Chain: delete().where().run()
  mockDelete.mockReturnValue({ where: mockWhere, run: mockRun });

  vi.mocked(getDb).mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
  } as any);
}

// Import after mocks
import { getDb } from '@/db/client';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('knowledge/repository', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setupMockDb();
  });

  // -------------------------------------------------------------------------
  // Sources
  // -------------------------------------------------------------------------

  describe('createSource', () => {
    it('inserts and returns a new knowledge source', async () => {
      const { createSource } = await import('@/modules/knowledge/repository');
      const source = createSource({
        inputType: 'file',
        originalName: 'setup.pdf',
        mimeType: 'application/pdf',
        relativePath: 'uploads/setup.pdf',
        sourceUrl: null,
        sha256: 'abc123',
        sizeBytes: 1024,
        status: 'stored',
        submittedBy: 'user-001',
      });

      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalled();
      expect(source.id).toBe('test-uuid');
      expect(source.sha256).toBe('abc123');
      expect(source.status).toBe('stored');
      expect(source.createdAt).toBe('2026-07-12T00:00:00.000Z');
      expect(source.updatedAt).toBe('2026-07-12T00:00:00.000Z');
    });
  });

  describe('getSource', () => {
    it('returns source when found', async () => {
      const mockSource = {
        id: 'src-001',
        inputType: 'file',
        sha256: 'abc123',
        status: 'stored',
      };
      mockAll.mockReturnValue([mockSource]);

      const { getSource } = await import('@/modules/knowledge/repository');
      const result = getSource('src-001');

      expect(result).toEqual(mockSource);
    });

    it('returns null when not found', async () => {
      mockAll.mockReturnValue([]);

      const { getSource } = await import('@/modules/knowledge/repository');
      const result = getSource('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('listSources', () => {
    it('returns paginated sources with cursor', async () => {
      const sources = Array.from({ length: 11 }, (_, i) => ({
        id: `src-${i}`,
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
        status: 'stored',
      }));
      mockAll.mockReturnValue(sources);

      const { listSources } = await import('@/modules/knowledge/repository');
      const result = listSources({ limit: 10 });

      expect(result.items.length).toBe(10);
      expect(result.nextCursor).toBeTruthy();
    });

    it('returns null nextCursor when no more pages', async () => {
      const sources = Array.from({ length: 3 }, (_, i) => ({
        id: `src-${i}`,
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
        status: 'stored',
      }));
      mockAll.mockReturnValue(sources);

      const { listSources } = await import('@/modules/knowledge/repository');
      const result = listSources({ limit: 10 });

      expect(result.items.length).toBe(3);
      expect(result.nextCursor).toBeNull();
    });

    it('passes status filter', async () => {
      mockAll.mockReturnValue([]);

      const { listSources } = await import('@/modules/knowledge/repository');
      listSources({ status: 'ready' });

      expect(mockWhere).toHaveBeenCalled();
    });
  });

  describe('findDuplicateBySha256', () => {
    it('returns source when duplicate found', async () => {
      const mockSource = { id: 'src-dup', sha256: 'abc123' };
      mockAll.mockReturnValue([mockSource]);

      const { findDuplicateBySha256 } = await import('@/modules/knowledge/repository');
      const result = findDuplicateBySha256('abc123');

      expect(result).toEqual(mockSource);
    });

    it('returns null when no duplicate', async () => {
      mockAll.mockReturnValue([]);

      const { findDuplicateBySha256 } = await import('@/modules/knowledge/repository');
      const result = findDuplicateBySha256('no-match');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Drafts
  // -------------------------------------------------------------------------

  describe('createDraft', () => {
    it('inserts and returns a new draft', async () => {
      const { createDraft } = await import('@/modules/knowledge/repository');
      const draft = createDraft({
        jobId: 'job-001',
        suggestedPath: 'tracks/spa.md',
        title: 'Spa Guide',
        frontMatterJson: '{}',
        draftRelativePath: 'drafts/spa.md',
        contentSha256: 'sha256draft',
        status: 'pending_review',
      });

      expect(mockInsert).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalled();
      expect(draft.id).toBe('test-uuid');
      expect(draft.jobId).toBe('job-001');
      expect(draft.status).toBe('pending_review');
      expect(draft.createdAt).toBe('2026-07-12T00:00:00.000Z');
    });
  });

  describe('getDraft', () => {
    it('returns draft when found', async () => {
      const mockDraft = { id: 'draft-001', jobId: 'job-001' };
      mockAll.mockReturnValue([mockDraft]);

      const { getDraft } = await import('@/modules/knowledge/repository');
      const result = getDraft('draft-001');

      expect(result).toEqual(mockDraft);
    });

    it('returns null when not found', async () => {
      mockAll.mockReturnValue([]);

      const { getDraft } = await import('@/modules/knowledge/repository');
      const result = getDraft('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getDraftByJobId', () => {
    it('returns draft for given job_id', async () => {
      const mockDraft = { id: 'draft-001', jobId: 'job-001' };
      mockAll.mockReturnValue([mockDraft]);

      const { getDraftByJobId } = await import('@/modules/knowledge/repository');
      const result = getDraftByJobId('job-001');

      expect(result).toEqual(mockDraft);
    });

    it('returns null when no draft for job', async () => {
      mockAll.mockReturnValue([]);

      const { getDraftByJobId } = await import('@/modules/knowledge/repository');
      const result = getDraftByJobId('job-none');

      expect(result).toBeNull();
    });
  });

  describe('updateDraft', () => {
    it('updates draft fields with timestamp', async () => {
      const { updateDraft } = await import('@/modules/knowledge/repository');
      updateDraft('draft-001', { status: 'approved', reviewNotes: 'LGTM' });

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith({
        status: 'approved',
        reviewNotes: 'LGTM',
        updatedAt: '2026-07-12T00:00:00.000Z',
      });
      expect(mockWhere).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalled();
    });
  });

  describe('supersedeOldDrafts', () => {
    it('supersedes other pending drafts for the same source', async () => {
      // Mock jobs query returning two jobs
      mockAll.mockReturnValue([
        { id: 'job-001', sourceId: 'src-001' },
        { id: 'job-002', sourceId: 'src-001' },
      ]);

      const { supersedeOldDrafts } = await import('@/modules/knowledge/repository');
      supersedeOldDrafts('src-001', 'draft-current');

      // First call: select jobs for source
      expect(mockSelect).toHaveBeenCalled();
      // Second call: update drafts
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith({
        status: 'superseded',
        updatedAt: '2026-07-12T00:00:00.000Z',
      });
      expect(mockRun).toHaveBeenCalled();
    });

    it('skips update when no jobs found for source', async () => {
      mockAll.mockReturnValue([]);

      const { supersedeOldDrafts } = await import('@/modules/knowledge/repository');
      supersedeOldDrafts('src-none', 'draft-current');

      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Items
  // -------------------------------------------------------------------------

  describe('createItem', () => {
    it('inserts and returns a new knowledge item', async () => {
      const { createItem } = await import('@/modules/knowledge/repository');
      const item = createItem({
        sourceId: 'src-001',
        draftId: 'draft-001',
        title: 'Spa Technique',
        category: 'driving-technique',
        subcategory: 'racing-line',
        tagsJson: '[]',
        sourceName: 'setup.pdf',
        sourceUrl: null,
        season: '2026-S1',
        wikiPath: 'tracks/spa',
        status: 'published',
        gitCommitSha: null,
        wikiSyncStatus: 'committed',
        publishedBy: 'user-001',
        publishedAt: '2026-07-12T00:00:00.000Z',
      });

      expect(mockInsert).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalled();
      expect(item.id).toBe('test-uuid');
      expect(item.title).toBe('Spa Technique');
      expect(item.updatedAt).toBe('2026-07-12T00:00:00.000Z');
    });
  });

  describe('getItem', () => {
    it('returns item when found', async () => {
      const mockItem = { id: 'item-001', title: 'Test' };
      mockAll.mockReturnValue([mockItem]);

      const { getItem } = await import('@/modules/knowledge/repository');
      const result = getItem('item-001');

      expect(result).toEqual(mockItem);
    });

    it('returns null when not found', async () => {
      mockAll.mockReturnValue([]);

      const { getItem } = await import('@/modules/knowledge/repository');
      const result = getItem('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getItemByWikiPath', () => {
    it('returns item for given wiki_path', async () => {
      const mockItem = { id: 'item-001', wikiPath: 'tracks/spa' };
      mockAll.mockReturnValue([mockItem]);

      const { getItemByWikiPath } = await import('@/modules/knowledge/repository');
      const result = getItemByWikiPath('tracks/spa');

      expect(result).toEqual(mockItem);
    });

    it('returns null when no item at path', async () => {
      mockAll.mockReturnValue([]);

      const { getItemByWikiPath } = await import('@/modules/knowledge/repository');
      const result = getItemByWikiPath('nonexistent/path');

      expect(result).toBeNull();
    });
  });

  describe('listItems', () => {
    it('returns paginated items with cursor', async () => {
      const items = Array.from({ length: 11 }, (_, i) => ({
        id: `item-${i}`,
        publishedAt: new Date(Date.now() - i * 1000).toISOString(),
        status: 'published',
      }));
      mockAll.mockReturnValue(items);

      const { listItems } = await import('@/modules/knowledge/repository');
      const result = listItems({ limit: 10 });

      expect(result.items.length).toBe(10);
      expect(result.nextCursor).toBeTruthy();
    });

    it('returns null nextCursor when no more pages', async () => {
      const items = Array.from({ length: 3 }, (_, i) => ({
        id: `item-${i}`,
        publishedAt: new Date(Date.now() - i * 1000).toISOString(),
        status: 'published',
      }));
      mockAll.mockReturnValue(items);

      const { listItems } = await import('@/modules/knowledge/repository');
      const result = listItems({ limit: 10 });

      expect(result.items.length).toBe(3);
      expect(result.nextCursor).toBeNull();
    });

    it('passes category and status filters', async () => {
      mockAll.mockReturnValue([]);

      const { listItems } = await import('@/modules/knowledge/repository');
      listItems({ category: 'driving-technique', status: 'published' });

      expect(mockWhere).toHaveBeenCalled();
    });
  });

  describe('archiveItem', () => {
    it('sets status to archived', async () => {
      const { archiveItem } = await import('@/modules/knowledge/repository');
      archiveItem('item-001');

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith({
        status: 'archived',
        updatedAt: '2026-07-12T00:00:00.000Z',
      });
      expect(mockRun).toHaveBeenCalled();
    });
  });

  describe('restoreItem', () => {
    it('sets status to published', async () => {
      const { restoreItem } = await import('@/modules/knowledge/repository');
      restoreItem('item-001');

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith({
        status: 'published',
        updatedAt: '2026-07-12T00:00:00.000Z',
      });
      expect(mockRun).toHaveBeenCalled();
    });
  });

  describe('updateSyncStatus', () => {
    it('updates sync status without commit sha', async () => {
      const { updateSyncStatus } = await import('@/modules/knowledge/repository');
      updateSyncStatus('item-001', 'synced');

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith({
        wikiSyncStatus: 'synced',
        updatedAt: '2026-07-12T00:00:00.000Z',
      });
      expect(mockRun).toHaveBeenCalled();
    });

    it('updates sync status with commit sha', async () => {
      const { updateSyncStatus } = await import('@/modules/knowledge/repository');
      updateSyncStatus('item-001', 'push_pending', 'sha-abc');

      expect(mockSet).toHaveBeenCalledWith({
        wikiSyncStatus: 'push_pending',
        gitCommitSha: 'sha-abc',
        updatedAt: '2026-07-12T00:00:00.000Z',
      });
    });
  });
});
