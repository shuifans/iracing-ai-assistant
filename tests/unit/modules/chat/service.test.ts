import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedUser } from '@/modules/auth/types';

// Mock all dependencies
vi.mock('@/modules/chat/repository', () => ({
  getSession: vi.fn(),
  createMessage: vi.fn(),
  updateMessage: vi.fn(),
  getMessage: vi.fn(),
  getMessageForUser: vi.fn(),
  getMessagesBySession: vi.fn(),
  createMessageSource: vi.fn(),
  updateQoderSessionId: vi.fn(),
  getAttachment: vi.fn(),
  createUserMessageWithAttachments: vi.fn(),
  getAttachmentsByMessage: vi.fn(),
  updateSessionTitle: vi.fn(),
}));

vi.mock('@/modules/chat/attachment-input', () => ({
  assertAttachmentBackendSupported: vi.fn((backend, hasAttachments) => {
    if (
      hasAttachments &&
      backend === 'llm-direct' &&
      process.env.LLM_IMAGE_INPUT_SUPPORTED === 'false'
    ) {
      throw Object.assign(new Error('当前模型后端不支持图片输入'), {
        code: 'VALIDATION_ERROR',
      });
    }
  }),
  loadAttachmentImages: vi.fn(async () => [{ base64: 'aW1hZ2U=', mediaType: 'image/png' }]),
}));

vi.mock('@/modules/rate-limit/service', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('@/modules/chat/session-context', () => ({
  generateSessionTitle: vi.fn(() => 'Generated Title'),
}));

vi.mock('@/modules/agent/client', () => ({
  createChatQuery: vi.fn(),
}));

vi.mock('@/modules/agent/llm-client', () => ({
  streamLlmDirect: vi.fn(),
  isLlmDirectConfigured: vi.fn(() => false),
}));

vi.mock('@/modules/knowledge/search-index', () => ({
  searchWiki: vi.fn(() => []),
}));

vi.mock('@/modules/chat/cache', () => ({
  getCachedAnswer: vi.fn(() => null),
  setCachedAnswer: vi.fn(),
  getCachedRetrieval: vi.fn(() => null),
  setCachedRetrieval: vi.fn(),
  makeCacheKey: vi.fn((content: string) => `key:${content}`),
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
  getMessage,
  getMessageForUser,
  getMessagesBySession,
  createMessageSource,
  updateSessionTitle,
  getAttachment,
  createUserMessageWithAttachments,
  getAttachmentsByMessage,
} from '@/modules/chat/repository';
import { createChatQuery } from '@/modules/agent/client';
import { streamLlmDirect, isLlmDirectConfigured } from '@/modules/agent/llm-client';
import { searchWiki } from '@/modules/knowledge/search-index';
import { checkRateLimit } from '@/modules/rate-limit/service';
import {
  getCachedAnswer,
  setCachedAnswer,
  getCachedRetrieval,
  setCachedRetrieval,
} from '@/modules/chat/cache';
import { streamChatMessage, stopMessage } from '@/modules/chat/service';
import { getDb } from '@/db/client';
import { AppError } from '@/lib/errors';

const mockGetSession = vi.mocked(getSession);
const mockCreateMessage = vi.mocked(createMessage);
const mockUpdateMessage = vi.mocked(updateMessage);
const mockGetMessage = vi.mocked(getMessage);
const mockGetMessageForUser = vi.mocked(getMessageForUser);
const mockGetMessagesBySession = vi.mocked(getMessagesBySession);
const mockCreateMessageSource = vi.mocked(createMessageSource);
const mockUpdateSessionTitle = vi.mocked(updateSessionTitle);
const mockCreateChatQuery = vi.mocked(createChatQuery);
const mockStreamLlmDirect = vi.mocked(streamLlmDirect);
const mockIsLlmDirectConfigured = vi.mocked(isLlmDirectConfigured);
const mockSearchWiki = vi.mocked(searchWiki);
const mockGetAttachment = vi.mocked(getAttachment);
const mockCreateUserMessageWithAttachments = vi.mocked(createUserMessageWithAttachments);
const mockGetAttachmentsByMessage = vi.mocked(getAttachmentsByMessage);
const mockGetDb = vi.mocked(getDb);
const mockCheckRateLimit = vi.mocked(checkRateLimit);
const mockGetCachedAnswer = vi.mocked(getCachedAnswer);
const mockSetCachedAnswer = vi.mocked(setCachedAnswer);
const mockGetCachedRetrieval = vi.mocked(getCachedRetrieval);
const mockSetCachedRetrieval = vi.mocked(setCachedRetrieval);

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
  webSearchEnabled: false,
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
    delete process.env.LLM_IMAGE_INPUT_SUPPORTED;
    delete process.env.CHAT_ANSWER_BACKEND;
    mockCheckRateLimit.mockReset();
    mockInsertValues.mockReturnValue({ run: mockInsertRun });
    mockGetSession.mockReturnValue(mockSession);
    mockCreateMessage.mockImplementation((_sessionId, role, _content, status) =>
      makeMockMessage(role, (status ?? 'pending') as MessageStatus),
    );
    mockGetMessagesBySession.mockReturnValue([]);
    mockIsLlmDirectConfigured.mockReturnValue(false);
    mockSearchWiki.mockReturnValue([]);
    mockGetCachedAnswer.mockReturnValue(null);
  });

  it('throws NOT_FOUND when session does not exist', async () => {
    mockGetSession.mockReturnValue(null);

    const generator = streamChatMessage(mockUser, 'nonexistent', 'Hello');

    await expect(async () => {
      await generator.next();
    }).rejects.toThrow('Session not found');
  });

  it('checks rate limits before creating messages or calling the model', async () => {
    mockCheckRateLimit.mockImplementation(() => {
      throw new AppError('RATE_LIMITED', 'Too many requests');
    });

    const generator = streamChatMessage(mockUser, 'sess-001', 'Hello');

    await expect(generator.next()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(mockCheckRateLimit).toHaveBeenCalledWith('user-001', 'user');
    expect(mockCreateMessage).not.toHaveBeenCalled();
    expect(mockCreateChatQuery).not.toHaveBeenCalled();
    expect(mockStreamLlmDirect).not.toHaveBeenCalled();
  });

  it('passes bound images to the Qoder model request', async () => {
    process.env.CHAT_ANSWER_BACKEND = 'qoder-sdk';
    const userMsg = makeMockMessage('user', 'complete', 'msg-user-image');
    const assistantMsg = makeMockMessage('assistant', 'pending', 'msg-asst-image');
    mockCreateUserMessageWithAttachments.mockReturnValue(userMsg);
    mockGetAttachmentsByMessage.mockReturnValue([{ relativePath: 'chat/image.png' } as any]);
    mockCreateMessage.mockReturnValue(assistantMsg);
    mockCreateChatQuery.mockReturnValue(
      createMockSDKStream([
        {
          type: 'result',
          subtype: 'success',
          session_id: 'qoder-image-session',
          usage: { input_tokens: 10, output_tokens: 5 },
          total_cost_usd: 0,
          duration_ms: 10,
        },
      ]) as any,
    );

    for await (const _ of streamChatMessage(mockUser, 'sess-001', 'inspect', ['attachment-1'])) {
      // drain
    }

    expect(mockCreateUserMessageWithAttachments).toHaveBeenCalledWith(
      'sess-001',
      'user-001',
      'inspect',
      ['attachment-1'],
    );
    expect(mockCreateChatQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        imageAttachments: [{ base64: 'aW1hZ2U=', mediaType: 'image/png' }],
      }),
    );
  });

  it('never reads or writes the shared answer cache for an image turn', async () => {
    process.env.CHAT_ANSWER_BACKEND = 'qoder-sdk';
    const userMsg = makeMockMessage('user', 'complete', 'msg-user-image-cache');
    const assistantMsg = makeMockMessage('assistant', 'pending', 'msg-asst-image-cache');
    mockCreateUserMessageWithAttachments.mockReturnValue(userMsg);
    mockGetAttachmentsByMessage.mockReturnValue([{ relativePath: 'chat/image.png' } as any]);
    mockCreateMessage.mockReturnValue(assistantMsg);
    mockCreateChatQuery.mockReturnValue(
      createMockSDKStream([
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'x'.repeat(250) }] },
        },
        {
          type: 'result',
          subtype: 'success',
          session_id: 'qoder-image-cache-session',
          usage: { input_tokens: 10, output_tokens: 5 },
          total_cost_usd: 0,
          duration_ms: 10,
        },
      ]) as any,
    );

    for await (const _ of streamChatMessage(mockUser, 'sess-001', 'same text', ['attachment-1'])) {
      // drain
    }

    expect(mockGetCachedAnswer).not.toHaveBeenCalled();
    expect(mockSetCachedAnswer).not.toHaveBeenCalled();
  });

  it('does not let an image answer poison a later same-text plain turn', async () => {
    process.env.CHAT_ANSWER_BACKEND = 'qoder-sdk';
    mockCreateUserMessageWithAttachments.mockReturnValue(
      makeMockMessage('user', 'complete', 'msg-user-image-first'),
    );
    mockGetAttachmentsByMessage.mockReturnValue([{ relativePath: 'chat/image.png' } as any]);
    mockCreateMessage.mockImplementation((_sessionId, role, _content, status) =>
      makeMockMessage(role, (status ?? 'pending') as MessageStatus),
    );
    const result = {
      type: 'result',
      subtype: 'success',
      session_id: 'qoder-cache-isolation',
      usage: { input_tokens: 10, output_tokens: 5 },
      total_cost_usd: 0,
      duration_ms: 10,
    };
    mockCreateChatQuery
      .mockReturnValueOnce(
        createMockSDKStream([
          { type: 'assistant', message: { content: [{ type: 'text', text: 'image answer '.repeat(30) }] } },
          result,
        ]) as any,
      )
      .mockReturnValueOnce(createMockSDKStream([result]) as any);
    mockGetCachedAnswer.mockImplementation(() =>
      mockSetCachedAnswer.mock.calls.length
        ? { content: 'poisoned image answer', sources: [], grounding: 'inferred' }
        : null,
    );

    for await (const _ of streamChatMessage(mockUser, 'sess-001', 'same text', ['attachment-1'])) {
      // drain image turn
    }
    for await (const _ of streamChatMessage(mockUser, 'sess-001', 'same text')) {
      // drain plain turn
    }

    expect(mockSetCachedAnswer).not.toHaveBeenCalled();
    expect(mockGetCachedAnswer).toHaveBeenCalledTimes(1);
    expect(mockCreateChatQuery).toHaveBeenCalledTimes(2);
  });

  it('passes bound images to the direct model request', async () => {
    process.env.CHAT_ANSWER_BACKEND = 'llm-direct';
    const userMsg = makeMockMessage('user', 'complete', 'msg-user-image');
    const assistantMsg = makeMockMessage('assistant', 'pending', 'msg-asst-image');
    mockCreateUserMessageWithAttachments.mockReturnValue(userMsg);
    mockGetAttachmentsByMessage.mockReturnValue([{ relativePath: 'chat/image.png' } as any]);
    mockCreateMessage.mockReturnValue(assistantMsg);
    mockIsLlmDirectConfigured.mockReturnValue(true);
    mockSearchWiki.mockReturnValue([
      {
        evidenceId: 'evidence-1',
        type: 'wiki',
        title: 'Vision context',
        wikiPath: 'vision.md',
        excerpt: 'context',
        score: 1,
        retrievedAt: '2026-07-14T00:00:00.000Z',
      },
    ]);
    mockStreamLlmDirect.mockReturnValue(
      (async function* () {
        yield { text: 'answer' };
        yield { text: '', usage: { inputTokens: 10, outputTokens: 5 } };
      })(),
    );

    for await (const _ of streamChatMessage(mockUser, 'sess-001', 'inspect', ['attachment-1'])) {
      // drain
    }

    expect(mockStreamLlmDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        imageAttachments: [{ base64: 'aW1hZ2U=', mediaType: 'image/png' }],
      }),
    );
    expect(mockGetCachedRetrieval).not.toHaveBeenCalled();
    expect(mockSetCachedRetrieval).not.toHaveBeenCalled();
    expect(mockCreateChatQuery).not.toHaveBeenCalled();
  });

  it('rejects an unsupported image backend before creating messages or invoking a model', async () => {
    process.env.CHAT_ANSWER_BACKEND = 'llm-direct';
    process.env.LLM_IMAGE_INPUT_SUPPORTED = 'false';

    const generator = streamChatMessage(mockUser, 'sess-001', 'inspect', ['attachment-1']);

    await expect(generator.next()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mockCreateMessage).not.toHaveBeenCalled();
    expect(mockCreateUserMessageWithAttachments).not.toHaveBeenCalled();
    expect(mockCreateChatQuery).not.toHaveBeenCalled();
    expect(mockStreamLlmDirect).not.toHaveBeenCalled();
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

    const evidencePayload = {
      evidence: [{
        evidenceId: 'ev-001',
        type: 'wiki',
        title: 'Test Evidence',
        wikiPath: 'test.md',
        excerpt: 'some excerpt',
        retrievedAt: '2026-07-14T00:00:00.000Z',
      }],
    };

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
    const events = [];
    for await (const event of generator) {
      events.push(event);
    }

    expect(events).toContainEqual(expect.objectContaining({
      source: expect.objectContaining({ id: 'ev-001', title: 'Test Evidence' }),
    }));
    expect(mockCreateMessageSource).toHaveBeenCalledWith(
      'msg-asst-001',
      0,
      expect.objectContaining({
        sourceType: 'wiki',
        title: 'Test Evidence',
        wikiPath: 'test.md',
      }),
    );

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
    mockCheckRateLimit.mockReset();
    mockGetSession.mockReturnValue(mockSession);
    mockCreateMessage.mockImplementation((_sessionId, role, _content, status) =>
      makeMockMessage(role, (status ?? 'pending') as MessageStatus),
    );
    mockGetMessagesBySession.mockReturnValue([]);
  });

  it('throws NOT_FOUND when message does not exist', async () => {
    mockGetMessageForUser.mockReturnValue(null);

    expect(() => stopMessage('nonexistent', 'user-001')).toThrow('Message not found');
  });

  it('does not let user B stop user A active response', async () => {
    const assistantMessage = makeMockMessage('assistant', 'pending', 'msg-asst-owned-by-a');
    mockCreateMessage
      .mockReturnValueOnce(makeMockMessage('user', 'complete', 'msg-user-a'))
      .mockReturnValueOnce(assistantMessage);
    mockGetMessage.mockReturnValue(assistantMessage);
    mockGetMessageForUser.mockReturnValue(null);
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    const generator = streamChatMessage(mockUser, 'sess-001', 'Hello');
    await generator.next();
    await generator.next();

    expect(() => stopMessage('msg-asst-owned-by-a', 'user-002')).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    expect(mockGetMessageForUser).toHaveBeenCalledWith('msg-asst-owned-by-a', 'user-002');
    expect(abortSpy).not.toHaveBeenCalled();

    await generator.return(undefined);
    abortSpy.mockRestore();
  });

  it('lets user A stop their own active response', async () => {
    const assistantMessage = makeMockMessage('assistant', 'pending', 'msg-asst-owned-by-a');
    mockCreateMessage
      .mockReturnValueOnce(makeMockMessage('user', 'complete', 'msg-user-a'))
      .mockReturnValueOnce(assistantMessage);
    mockGetMessageForUser.mockReturnValue(assistantMessage);
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    const generator = streamChatMessage(mockUser, 'sess-001', 'Hello');
    await generator.next();
    await generator.next();

    expect(() => stopMessage('msg-asst-owned-by-a', 'user-001')).not.toThrow();
    expect(mockGetMessageForUser).toHaveBeenCalledWith('msg-asst-owned-by-a', 'user-001');
    expect(abortSpy).toHaveBeenCalledTimes(1);

    await generator.return(undefined);
    abortSpy.mockRestore();
  });

  it('is idempotent when an owned message is no longer active', () => {
    mockGetMessageForUser.mockReturnValue(
      makeMockMessage('assistant', 'complete', 'msg-asst-complete'),
    );

    expect(() => stopMessage('msg-asst-complete', 'user-001')).not.toThrow();
  });
});
