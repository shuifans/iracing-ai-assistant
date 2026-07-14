import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedUser } from '@/modules/auth/types';

// Mock all dependencies
vi.mock('@/modules/chat/repository', () => ({
  getSession: vi.fn(),
  createMessage: vi.fn(),
  updateMessage: vi.fn(),
  getMessage: vi.fn(),
  getMessagesBySession: vi.fn(),
  createMessageSource: vi.fn(),
  updateQoderSessionId: vi.fn(),
  getAttachment: vi.fn(),
  updateSessionTitle: vi.fn(),
}));

vi.mock('@/modules/chat/session-context', () => ({
  generateSessionTitle: vi.fn(() => 'Generated Title'),
}));

vi.mock('@/modules/agent/client', () => ({
  createChatQuery: vi.fn(),
}));

vi.mock('@/lib/uuid', () => ({
  generateId: vi.fn(() => 'mock-uuid'),
}));

vi.mock('@/lib/datetime', () => ({
  utcNow: vi.fn(() => '2026-07-12T00:00:00.000Z'),
}));

// Mock DB for usage event recording
const mockInsertValues = vi.fn();
const mockInsertRun = vi.fn();
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
mockInsertValues.mockReturnValue({ run: mockInsertRun });

vi.mock('@/db/client', () => ({
  getDb: vi.fn(() => ({ insert: mockInsert })),
}));

vi.mock('@/db/schema/admin', () => ({
  usageEvents: Symbol('usageEvents'),
}));

// Import after mocks
import {
  getSession,
  createMessage,
  updateMessage,
  getMessagesBySession,
  updateSessionTitle,
  getAttachment,
} from '@/modules/chat/repository';
import { createChatQuery } from '@/modules/agent/client';
import { streamChatMessage, stopMessage } from '@/modules/chat/service';
import { getDb } from '@/db/client';

const mockGetSession = vi.mocked(getSession);
const mockCreateMessage = vi.mocked(createMessage);
const mockUpdateMessage = vi.mocked(updateMessage);
const mockGetMessagesBySession = vi.mocked(getMessagesBySession);
const mockUpdateSessionTitle = vi.mocked(updateSessionTitle);
const mockCreateChatQuery = vi.mocked(createChatQuery);
const mockGetAttachment = vi.mocked(getAttachment);
const mockGetDb = vi.mocked(getDb);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockUser: AuthenticatedUser = {
  id: 'user-001',
  username: 'testuser',
  role: 'user',
  status: 'active',
};

const mockSession = {
  id: 'sess-001',
  userId: 'user-001',
  title: 'Test Session',
  status: 'active' as const,
  qoderSessionId: null,
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
  lastMessageAt: '2026-07-12T00:00:00.000Z',
};

type MessageStatus = 'pending' | 'streaming' | 'complete' | 'interrupted' | 'failed';

function makeMockMessage(role: string, status: MessageStatus, id?: string) {
  return {
    id: id ?? `msg-${role}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: 'sess-001',
    role: role as 'user' | 'assistant',
    status,
    content: '',
    replyToMessageId: null,
    errorCode: null,
    tokenInput: 0,
    tokenOutput: 0,
    costMicrousd: 0,
    durationMs: 0,
    createdAt: '2026-07-12T00:00:00.000Z',
    completedAt: null,
  };
}

// Create a mock SDK message stream
function createMockSDKStream(events: Array<{ type: string; [key: string]: unknown }>) {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('streamChatMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertValues.mockReturnValue({ run: mockInsertRun });
    mockGetSession.mockReturnValue(mockSession);
    mockCreateMessage.mockImplementation((_sessionId, role, _content, status) =>
      makeMockMessage(role, (status ?? 'pending') as MessageStatus),
    );
    mockGetMessagesBySession.mockReturnValue([]);
  });

  it('throws NOT_FOUND when session does not exist', async () => {
    mockGetSession.mockReturnValue(null);

    const generator = streamChatMessage(mockUser, 'nonexistent', 'Hello');

    await expect(async () => {
      await generator.next();
    }).rejects.toThrow('Session not found');
  });

  it('yields start, delta, and done events on successful stream', async () => {
    const userMsg = makeMockMessage('user', 'complete', 'msg-user-001');
    const assistantMsg = makeMockMessage('assistant', 'pending', 'msg-asst-001');

    mockCreateMessage.mockReturnValueOnce(userMsg).mockReturnValueOnce(assistantMsg);

    // Mock SDK stream with text delta and result
    const mockStream = createMockSDKStream([
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
        session_id: 'qoder-sess-001',
      },
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world!' } },
        session_id: 'qoder-sess-001',
      },
      {
        type: 'result',
        subtype: 'success',
        session_id: 'qoder-sess-001',
        usage: { input_tokens: 100, output_tokens: 50 },
        total_cost_usd: 0.001,
        duration_ms: 2000,
      },
    ]);
    mockCreateChatQuery.mockReturnValue(mockStream as any);

    const generator = streamChatMessage(mockUser, 'sess-001', 'Hello');
    const events = [];
    for await (const event of generator) {
      events.push(event);
    }

    // Should have: start, delta, delta, usage, done
    expect(events.length).toBeGreaterThanOrEqual(4);

    // First event should be start
    expect(events[0]).toMatchObject({
      requestId: 'mock-uuid',
      sessionId: 'sess-001',
    });

    // Should have delta events
    const deltaEvents = events.filter((e) => 'seq' in e);
    expect(deltaEvents.length).toBe(2);
    expect((deltaEvents[0] as any).text).toBe('Hello ');
    expect((deltaEvents[1] as any).text).toBe('world!');

    // Should have done event
    const doneEvent = events.find((e) => 'grounding' in e);
    expect(doneEvent).toBeDefined();
    expect((doneEvent as any).status).toBe('complete');
  });

  it('updates message to complete status after successful stream', async () => {
    const userMsg = makeMockMessage('user', 'complete', 'msg-user-001');
    const assistantMsg = makeMockMessage('assistant', 'pending', 'msg-asst-001');

    mockCreateMessage.mockReturnValueOnce(userMsg).mockReturnValueOnce(assistantMsg);

    const mockStream = createMockSDKStream([
      {
        type: 'result',
        subtype: 'success',
        session_id: 'qoder-sess-001',
        usage: { input_tokens: 100, output_tokens: 50 },
        total_cost_usd: 0.001,
        duration_ms: 2000,
      },
    ]);
    mockCreateChatQuery.mockReturnValue(mockStream as any);

    const generator = streamChatMessage(mockUser, 'sess-001', 'Hello');
    // Consume all events
    for await (const _ of generator) {
      // drain
    }

    // Should update message to complete
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'msg-asst-001',
      expect.objectContaining({ status: 'complete' }),
    );
  });

  it('generates title on first assistant response', async () => {
    const userMsg = makeMockMessage('user', 'complete', 'msg-user-001');
    const assistantMsg = makeMockMessage('assistant', 'pending', 'msg-asst-001');

    mockCreateMessage.mockReturnValueOnce(userMsg).mockReturnValueOnce(assistantMsg);

    // Only one assistant message (the current one being created)
    mockGetMessagesBySession.mockReturnValue([userMsg, { ...assistantMsg, status: 'complete' }]);

    const mockStream = createMockSDKStream([
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'First response' },
        },
        session_id: 'qoder-sess-001',
      },
      {
        type: 'result',
        subtype: 'success',
        session_id: 'qoder-sess-001',
        usage: { input_tokens: 100, output_tokens: 50 },
        total_cost_usd: 0.001,
        duration_ms: 2000,
      },
    ]);
    mockCreateChatQuery.mockReturnValue(mockStream as any);

    const generator = streamChatMessage(mockUser, 'sess-001', 'Hello');
    for await (const _ of generator) {
      // drain
    }

    // Should generate and update title
    expect(mockUpdateSessionTitle).toHaveBeenCalledWith('sess-001', 'Generated Title');
  });

  it('yields error event on SDK error result', async () => {
    const userMsg = makeMockMessage('user', 'complete', 'msg-user-001');
    const assistantMsg = makeMockMessage('assistant', 'pending', 'msg-asst-001');

    mockCreateMessage.mockReturnValueOnce(userMsg).mockReturnValueOnce(assistantMsg);

    const mockStream = createMockSDKStream([
      {
        type: 'result',
        subtype: 'error_during_execution',
        session_id: 'qoder-sess-001',
        errors: ['Something went wrong'],
        usage: { input_tokens: 0, output_tokens: 0 },
        total_cost_usd: 0,
        duration_ms: 100,
      },
    ]);
    mockCreateChatQuery.mockReturnValue(mockStream as any);

    const generator = streamChatMessage(mockUser, 'sess-001', 'Hello');
    const events = [];
    for await (const event of generator) {
      events.push(event);
    }

    // Should have error event
    const errorEvent = events.find((e) => 'code' in e);
    expect(errorEvent).toBeDefined();
    expect((errorEvent as any).code).toBe('AGENT_UNAVAILABLE');
  });

  it('handles abort (stop) gracefully', async () => {
    const userMsg = makeMockMessage('user', 'complete', 'msg-user-001');
    const assistantMsg = makeMockMessage('assistant', 'pending', 'msg-asst-001');

    mockCreateMessage.mockReturnValueOnce(userMsg).mockReturnValueOnce(assistantMsg);

    // Create a stream that throws AbortError
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';

    const mockStream = (async function* () {
      yield {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Partial ' } },
        session_id: 'qoder-sess-001',
      };
      throw abortError;
    })();
    mockCreateChatQuery.mockReturnValue(mockStream as any);

    const generator = streamChatMessage(mockUser, 'sess-001', 'Hello');
    const events = [];
    for await (const event of generator) {
      events.push(event);
    }

    // Should update to interrupted status
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'msg-asst-001',
      expect.objectContaining({ status: 'interrupted' }),
    );

    // Should have done event with interrupted status
    const doneEvent = events.find((e) => 'grounding' in e);
    expect(doneEvent).toBeDefined();
    expect((doneEvent as any).status).toBe('interrupted');
  });
  it('records usage event with result=success on successful stream', async () => {
    const userMsg = makeMockMessage('user', 'complete', 'msg-user-001');
    const assistantMsg = makeMockMessage('assistant', 'pending', 'msg-asst-001');

    mockCreateMessage.mockReturnValueOnce(userMsg).mockReturnValueOnce(assistantMsg);

    const mockStream = createMockSDKStream([
      {
        type: 'result',
        subtype: 'success',
        session_id: 'qoder-sess-001',
        usage: { input_tokens: 100, output_tokens: 50 },
        total_cost_usd: 0.001,
        duration_ms: 2000,
      },
    ]);
    mockCreateChatQuery.mockReturnValue(mockStream as any);

    const generator = streamChatMessage(mockUser, 'sess-001', 'Hello');
    for await (const _ of generator) {
      // drain
    }

    expect(mockInsert).toHaveBeenCalled();
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-001',
        sessionId: 'sess-001',
        eventType: 'chat',
        tokenInput: 100,
        tokenOutput: 50,
        costMicrousd: 1000,
        durationMs: 2000,
        result: 'success',
        knowledgeHit: 'false',
      }),
    );
    expect(mockInsertRun).toHaveBeenCalled();
  });

  it('records usage event with result=error on SDK error result', async () => {
    const userMsg = makeMockMessage('user', 'complete', 'msg-user-001');
    const assistantMsg = makeMockMessage('assistant', 'pending', 'msg-asst-001');

    mockCreateMessage.mockReturnValueOnce(userMsg).mockReturnValueOnce(assistantMsg);

    const mockStream = createMockSDKStream([
      {
        type: 'result',
        subtype: 'error_during_execution',
        session_id: 'qoder-sess-001',
        errors: ['Something went wrong'],
        usage: { input_tokens: 0, output_tokens: 0 },
        total_cost_usd: 0,
        duration_ms: 100,
      },
    ]);
    mockCreateChatQuery.mockReturnValue(mockStream as any);

    const generator = streamChatMessage(mockUser, 'sess-001', 'Hello');
    for await (const _ of generator) {
      // drain
    }

    expect(mockInsert).toHaveBeenCalled();
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-001',
        sessionId: 'sess-001',
        eventType: 'chat',
        result: 'error',
      }),
    );
  });

  it('records usage event with knowledgeHit=true when evidence is present', async () => {
    const userMsg = makeMockMessage('user', 'complete', 'msg-user-001');
    const assistantMsg = makeMockMessage('assistant', 'pending', 'msg-asst-001');

    mockCreateMessage.mockReturnValueOnce(userMsg).mockReturnValueOnce(assistantMsg);

    const evidencePayload = [
      {
        evidenceId: 'ev-001',
        type: 'wiki',
        title: 'Test Evidence',
        wikiPath: '/test.md',
        excerpt: 'some excerpt',
      },
    ];

    const mockStream = createMockSDKStream([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Answer with evidence' },
            {
              type: 'tool_result',
              content: JSON.stringify(evidencePayload),
            },
          ],
        },
      },
      {
        type: 'result',
        subtype: 'success',
        session_id: 'qoder-sess-001',
        usage: { input_tokens: 200, output_tokens: 100 },
        total_cost_usd: 0.002,
        duration_ms: 3000,
      },
    ]);
    mockCreateChatQuery.mockReturnValue(mockStream as any);

    const generator = streamChatMessage(mockUser, 'sess-001', 'Hello');
    for await (const _ of generator) {
      // drain
    }

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'success',
        knowledgeHit: 'true',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// stopMessage
// ---------------------------------------------------------------------------

describe('stopMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws NOT_FOUND when message does not exist', async () => {
    const { getMessage } = await import('@/modules/chat/repository');
    vi.mocked(getMessage).mockReturnValue(null);

    expect(() => stopMessage('nonexistent', 'user-001')).toThrow('Message not found');
  });
});
