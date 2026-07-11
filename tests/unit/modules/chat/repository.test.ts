import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB client and drizzle-orm before importing repository
vi.mock('@/db/client', () => ({
  getDb: vi.fn(),
}));

vi.mock('@/lib/uuid', () => ({
  generateId: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).slice(2, 8)),
}));

vi.mock('@/lib/datetime', () => ({
  utcNow: vi.fn(() => '2026-07-12T00:00:00.000Z'),
}));

// Create mock DB with chainable methods
const mockRun = vi.fn();
const mockAll = vi.fn();
const mockReturning = vi.fn();
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
  mockWhere.mockReturnValue({ limit: mockLimit, orderBy: mockOrderBy, run: mockRun });
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

describe('repository', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setupMockDb();
  });

  describe('createSession', () => {
    it('creates a session with default title', async () => {
      const { createSession } = await import('@/modules/chat/repository');
      const session = createSession('user-001');

      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalled();
      expect(session.userId).toBe('user-001');
      expect(session.title).toBe('新会话');
      expect(session.status).toBe('active');
    });

    it('creates a session with custom title', async () => {
      const { createSession } = await import('@/modules/chat/repository');
      const session = createSession('user-001', 'Custom Title');

      expect(session.title).toBe('Custom Title');
    });
  });

  describe('getSession', () => {
    it('returns session when found with matching userId', async () => {
      const mockSession = {
        id: 'sess-001',
        userId: 'user-001',
        title: 'Test',
        status: 'active',
        createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
        lastMessageAt: '2026-07-12T00:00:00.000Z',
        qoderSessionId: null,
      };
      mockAll.mockReturnValue([mockSession]);

      const { getSession } = await import('@/modules/chat/repository');
      const result = getSession('sess-001', 'user-001');

      expect(result).toEqual(mockSession);
    });

    it('returns null when session not found', async () => {
      mockAll.mockReturnValue([]);

      const { getSession } = await import('@/modules/chat/repository');
      const result = getSession('nonexistent', 'user-001');

      expect(result).toBeNull();
    });
  });

  describe('listSessions', () => {
    it('returns sessions with pagination', async () => {
      const sessions = Array.from({ length: 11 }, (_, i) => ({
        id: `sess-${i}`,
        userId: 'user-001',
        title: `Session ${i}`,
        status: 'active',
        createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
        lastMessageAt: new Date(Date.now() - i * 1000).toISOString(),
        qoderSessionId: null,
      }));
      mockAll.mockReturnValue(sessions);

      const { listSessions } = await import('@/modules/chat/repository');
      const result = listSessions('user-001', 10);

      expect(result.sessions.length).toBe(10);
      expect(result.nextCursor).toBeTruthy();
    });

    it('returns null nextCursor when no more pages', async () => {
      const sessions = Array.from({ length: 5 }, (_, i) => ({
        id: `sess-${i}`,
        userId: 'user-001',
        title: `Session ${i}`,
        status: 'active',
        createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
        lastMessageAt: new Date(Date.now() - i * 1000).toISOString(),
        qoderSessionId: null,
      }));
      mockAll.mockReturnValue(sessions);

      const { listSessions } = await import('@/modules/chat/repository');
      const result = listSessions('user-001', 10);

      expect(result.sessions.length).toBe(5);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('deleteSession', () => {
    it('calls delete with session and user conditions', async () => {
      const { deleteSession } = await import('@/modules/chat/repository');
      deleteSession('sess-001', 'user-001');

      expect(mockDelete).toHaveBeenCalled();
      expect(mockWhere).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalled();
    });
  });

  describe('createMessage', () => {
    it('creates a user message with complete status', async () => {
      const { createMessage } = await import('@/modules/chat/repository');
      const msg = createMessage('sess-001', 'user', 'Hello', 'complete');

      expect(mockInsert).toHaveBeenCalled();
      expect(msg.sessionId).toBe('sess-001');
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello');
      expect(msg.status).toBe('complete');
    });

    it('creates an assistant message with pending status', async () => {
      const { createMessage } = await import('@/modules/chat/repository');
      const msg = createMessage('sess-001', 'assistant', '', 'pending');

      expect(msg.role).toBe('assistant');
      expect(msg.status).toBe('pending');
    });
  });

  describe('updateMessage', () => {
    it('updates message fields', async () => {
      const { updateMessage } = await import('@/modules/chat/repository');
      updateMessage('msg-001', { status: 'complete', content: 'Final content' });

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith({ status: 'complete', content: 'Final content' });
    });
  });

  describe('upsertFeedback', () => {
    it('creates new feedback when none exists', async () => {
      mockAll.mockReturnValue([]); // No existing feedback

      const { upsertFeedback } = await import('@/modules/chat/repository');
      upsertFeedback('msg-001', 'user-001', 'up', 'Very helpful');

      expect(mockInsert).toHaveBeenCalled();
    });

    it('updates existing feedback', async () => {
      mockAll.mockReturnValue([{ id: 'fb-001', rating: 'up', reason: null }]);

      const { upsertFeedback } = await import('@/modules/chat/repository');
      upsertFeedback('msg-001', 'user-001', 'down', 'Not helpful');

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith({
        rating: 'down',
        reason: 'Not helpful',
        updatedAt: '2026-07-12T00:00:00.000Z',
      });
    });
  });

  describe('deleteFeedback', () => {
    it('deletes feedback for message and user', async () => {
      const { deleteFeedback } = await import('@/modules/chat/repository');
      deleteFeedback('msg-001', 'user-001');

      expect(mockDelete).toHaveBeenCalled();
      expect(mockWhere).toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalled();
    });
  });
});
