import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB client and helpers before importing repository
vi.mock('@/db/client', () => ({
  getDb: vi.fn(),
}));

vi.mock('@/lib/uuid', () => ({
  generateId: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).slice(2, 8)),
}));

vi.mock('@/lib/datetime', () => ({
  utcNow: vi.fn(() => '2026-07-12T00:00:00.000Z'),
}));

// Chainable mock methods
const mockRun = vi.fn();
const mockAll = vi.fn();
const mockLimit = vi.fn();
const mockOrderBy = vi.fn();
const mockWhere = vi.fn();
const mockValues = vi.fn();
const mockFrom = vi.fn();
const mockInsert = vi.fn();
const mockSelect = vi.fn();

function setupMockDb() {
  // select().from().where().orderBy().limit().all()
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ orderBy: mockOrderBy, limit: mockLimit });
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockLimit.mockReturnValue({ all: mockAll });
  mockAll.mockReturnValue([]);

  // insert().values().run()
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ run: mockRun });

  vi.mocked(getDb).mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
  } as any);
}

// Import after mocks
import { getDb } from '@/db/client';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('audit/repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMockDb();
  });

  describe('writeAuditLog', () => {
    it('inserts an audit log with all required fields', async () => {
      const { writeAuditLog } = await import('@/modules/audit/repository');
      const entry = writeAuditLog({
        actorId: 'admin-001',
        action: 'user.approved',
        resource: 'user',
        resourceId: 'user-002',
      });

      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'admin-001',
          action: 'user.approved',
          resource: 'user',
          resourceId: 'user-002',
          requestId: null,
          ipHash: null,
          changesJson: null,
          createdAt: '2026-07-12T00:00:00.000Z',
        }),
      );
      expect(mockRun).toHaveBeenCalled();
      expect(entry.actorId).toBe('admin-001');
      expect(entry.id).toMatch(/^mock-uuid-/);
    });

    it('serializes changes as JSON when provided', async () => {
      const { writeAuditLog } = await import('@/modules/audit/repository');
      const changes = { role: { from: 'user', to: 'admin' } };
      writeAuditLog({
        actorId: 'admin-001',
        action: 'user.role_changed',
        resource: 'user',
        resourceId: 'user-002',
        changes,
      });

      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          changesJson: JSON.stringify(changes),
        }),
      );
    });

    it('passes optional requestId and ipHash', async () => {
      const { writeAuditLog } = await import('@/modules/audit/repository');
      writeAuditLog({
        actorId: 'admin-001',
        action: 'session.viewed',
        resource: 'session',
        resourceId: 'sess-001',
        requestId: 'req-abc',
        ipHash: 'sha256-hash',
      });

      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-abc',
          ipHash: 'sha256-hash',
        }),
      );
    });
  });

  describe('listAuditLogs', () => {
    it('returns paginated results with nextCursor', async () => {
      const rows = Array.from({ length: 11 }, (_, i) => ({
        id: `log-${i}`,
        actorId: 'admin-001',
        action: 'user.approved',
        resource: 'user',
        resourceId: `user-${i}`,
        requestId: null,
        ipHash: null,
        changesJson: null,
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
      }));
      mockAll.mockReturnValue(rows);

      const { listAuditLogs } = await import('@/modules/audit/repository');
      const result = listAuditLogs({ limit: 10 });

      expect(result.items.length).toBe(10);
      expect(result.nextCursor).toBeTruthy();
    });

    it('returns null nextCursor when no more pages', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => ({
        id: `log-${i}`,
        actorId: 'admin-001',
        action: 'user.approved',
        resource: 'user',
        resourceId: `user-${i}`,
        requestId: null,
        ipHash: null,
        changesJson: null,
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
      }));
      mockAll.mockReturnValue(rows);

      const { listAuditLogs } = await import('@/modules/audit/repository');
      const result = listAuditLogs({ limit: 10 });

      expect(result.items.length).toBe(3);
      expect(result.nextCursor).toBeNull();
    });

    it('applies cursor filter', async () => {
      mockAll.mockReturnValue([]);

      const { listAuditLogs } = await import('@/modules/audit/repository');
      listAuditLogs({ cursor: '2026-07-11T00:00:00.000Z' });

      // where should be called (conditions built)
      expect(mockWhere).toHaveBeenCalled();
    });

    it('applies actorId filter', async () => {
      mockAll.mockReturnValue([]);

      const { listAuditLogs } = await import('@/modules/audit/repository');
      listAuditLogs({ actorId: 'admin-001' });

      expect(mockWhere).toHaveBeenCalled();
    });

    it('applies action filter', async () => {
      mockAll.mockReturnValue([]);

      const { listAuditLogs } = await import('@/modules/audit/repository');
      listAuditLogs({ action: 'user.approved' });

      expect(mockWhere).toHaveBeenCalled();
    });

    it('applies resource and resourceId filters', async () => {
      mockAll.mockReturnValue([]);

      const { listAuditLogs } = await import('@/modules/audit/repository');
      listAuditLogs({ resource: 'user', resourceId: 'user-002' });

      expect(mockWhere).toHaveBeenCalled();
    });

    it('applies fromDate and toDate filters', async () => {
      mockAll.mockReturnValue([]);

      const { listAuditLogs } = await import('@/modules/audit/repository');
      listAuditLogs({
        fromDate: '2026-07-01T00:00:00.000Z',
        toDate: '2026-07-12T23:59:59.999Z',
      });

      expect(mockWhere).toHaveBeenCalled();
    });

    it('uses default limit of 50', async () => {
      mockAll.mockReturnValue([]);

      const { listAuditLogs } = await import('@/modules/audit/repository');
      listAuditLogs({});

      // limit called with 51 (limit + 1 for hasMore check)
      expect(mockLimit).toHaveBeenCalledWith(51);
    });
  });
});
