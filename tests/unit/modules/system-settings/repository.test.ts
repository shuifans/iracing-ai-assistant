import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @/db/client before importing the repository
vi.mock('@/db/client', () => ({
  getDb: vi.fn(),
}));

vi.mock('@/lib/uuid', () => ({
  generateId: vi.fn(() => 'mock-id'),
}));

vi.mock('@/lib/datetime', () => ({
  utcNow: vi.fn(() => '2026-07-14T00:00:00.000Z'),
}));

import { getDb } from '@/db/client';

// Mock DB chain: select().from().where().get() + insert().values().onConflictDoUpdate().run()
const mockGet = vi.fn();
const mockRun = vi.fn();
const mockWhere = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockOnConflict = vi.fn();
const mockValues = vi.fn();
const mockInsert = vi.fn();

function setupMockDb() {
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ get: mockGet });

  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflict });
  mockOnConflict.mockReturnValue({ run: mockRun });

  vi.mocked(getDb).mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
  } as any);
}

describe('system-settings/repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMockDb();
  });

  describe('getSetting', () => {
    it('returns the row value when present', async () => {
      mockGet.mockReturnValue({ value: 'some-value' });
      const { getSetting } = await import('@/modules/system-settings/repository');

      expect(getSetting('some.key')).toBe('some-value');
    });

    it('returns the default when the row is absent', async () => {
      mockGet.mockReturnValue(undefined);
      const { getSetting } = await import('@/modules/system-settings/repository');

      expect(getSetting('missing.key', 'fallback')).toBe('fallback');
    });

    it('returns undefined when absent and no default', async () => {
      mockGet.mockReturnValue(undefined);
      const { getSetting } = await import('@/modules/system-settings/repository');

      expect(getSetting('missing.key')).toBeUndefined();
    });
  });

  describe('upsertSetting', () => {
    it('inserts with on-conflict-update', async () => {
      const { upsertSetting } = await import('@/modules/system-settings/repository');
      upsertSetting({ key: 'feature.example', value: 'enabled', description: 'desc' });

      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'feature.example',
          value: 'enabled',
          description: 'desc',
        }),
      );
      expect(mockOnConflict).toHaveBeenCalledWith(
        expect.objectContaining({ set: expect.objectContaining({ value: 'enabled' }) }),
      );
      expect(mockRun).toHaveBeenCalled();
    });
  });
});
