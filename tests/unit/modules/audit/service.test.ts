import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the repository module
vi.mock('@/modules/audit/repository', () => ({
  writeAuditLog: vi.fn(),
}));

import { writeAuditLog } from '@/modules/audit/repository';

describe('audit/service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordAudit', () => {
    it('delegates to writeAuditLog with all params', async () => {
      const mockEntry = {
        id: 'mock-uuid-abc',
        actorId: 'admin-001',
        action: 'user.approved',
        resource: 'user',
        resourceId: 'user-002',
        requestId: null,
        ipHash: null,
        changesJson: null,
        createdAt: '2026-07-12T00:00:00.000Z',
      };
      vi.mocked(writeAuditLog).mockReturnValue(mockEntry);

      const { recordAudit } = await import('@/modules/audit/service');
      const result = recordAudit({
        actorId: 'admin-001',
        action: 'user.approved',
        resource: 'user',
        resourceId: 'user-002',
      });

      expect(writeAuditLog).toHaveBeenCalledWith({
        actorId: 'admin-001',
        action: 'user.approved',
        resource: 'user',
        resourceId: 'user-002',
      });
      expect(result).toEqual(mockEntry);
    });

    it('forwards optional fields', async () => {
      const mockEntry = {
        id: 'mock-uuid-def',
        actorId: 'admin-001',
        action: 'user.role_changed',
        resource: 'user',
        resourceId: 'user-002',
        requestId: 'req-abc',
        ipHash: 'sha256-hash',
        changesJson: JSON.stringify({ role: { from: 'user', to: 'admin' } }),
        createdAt: '2026-07-12T00:00:00.000Z',
      };
      vi.mocked(writeAuditLog).mockReturnValue(mockEntry);

      const { recordAudit } = await import('@/modules/audit/service');
      const changes = { role: { from: 'user', to: 'admin' } };
      const result = recordAudit({
        actorId: 'admin-001',
        action: 'user.role_changed',
        resource: 'user',
        resourceId: 'user-002',
        requestId: 'req-abc',
        ipHash: 'sha256-hash',
        changes,
      });

      expect(writeAuditLog).toHaveBeenCalledWith({
        actorId: 'admin-001',
        action: 'user.role_changed',
        resource: 'user',
        resourceId: 'user-002',
        requestId: 'req-abc',
        ipHash: 'sha256-hash',
        changes,
      });
      expect(result).toEqual(mockEntry);
    });

    it('returns the audit log entry from repository', async () => {
      const mockEntry = {
        id: 'mock-uuid-ghi',
        actorId: 'admin-001',
        action: 'knowledge.approved',
        resource: 'knowledge_source',
        resourceId: 'ks-001',
        requestId: null,
        ipHash: null,
        changesJson: null,
        createdAt: '2026-07-12T00:00:00.000Z',
      };
      vi.mocked(writeAuditLog).mockReturnValue(mockEntry);

      const { recordAudit } = await import('@/modules/audit/service');
      const result = recordAudit({
        actorId: 'admin-001',
        action: 'knowledge.approved',
        resource: 'knowledge_source',
        resourceId: 'ks-001',
      });

      expect(result.id).toBe('mock-uuid-ghi');
      expect(result.action).toBe('knowledge.approved');
    });
  });
});
