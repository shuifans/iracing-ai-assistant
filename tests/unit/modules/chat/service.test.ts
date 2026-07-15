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
  assertAttachmentBackendSupported: vi.fn(),
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

vi.mock('@/modules/web-sources/service', () => ({
  listEnabledWebSourceRules: vi.fn(() => []),
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
  updateQoderSessionId,
} from '@/modules/chat/repository';
import { createChatQuery } from '@/modules/agent/client';
import { checkRateLimit } from '@/modules/rate-limit/service';
import { listEnabledWebSourceRules } from '@/modules/web-sources/service';
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
const mockUpdateQoderSessionId = vi.mocked(updateQoderSessionId);
const mockCreateChatQuery = vi.mocked(createChatQuery);
const mockListEnabledWebSourceRules = vi.mocked(listEnabledWebSourceRules);
const mockGetAttachment = vi.mocked(getAttachment);
const mockCreateUserMessageWithAttachments = vi.mocked(createUserMessageWithAttachments);
const mockGetAttachmentsByMessage = vi.mocked(getAttachmentsByMessage);
const mockGetDb = vi.mocked(getDb);
const mockCheckRateLimit = vi.mocked(checkRateLimit);

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
    mockCreateChatQuery.mockReset();
    delete process.env.WEB_KNOWLEDGE_SOURCES_SNAPSHOT_PATH;
    mockCheckRateLimit.mockReset();
    mockInsertValues.mockReturnValue({ run: mockInsertRun });
    mockGetSession.mockReturnValue(mockSession);
    mockCreateMessage.mockImplementation((_sessionId, role, _content, status) =>
      makeMockMessage(role, (status ?? 'pending') as MessageStatus),
    );
    mockGetMessagesBySession.mockReturnValue([]);
    mockListEnabledWebSourceRules.mockReturnValue([]);
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
  });

  it('always creates one Qoder query with only the current turn and the session Web flag', async () => {
    mockGetSession.mockReturnValue({
      ...mockSession,
      qoderSessionId: 'qoder-existing',
      webSearchEnabled: true,
    });
    mockCreateChatQuery.mockReturnValue(
      createMockSDKStream([
        {
          type: 'result',
          subtype: 'error_during_execution',
          session_id: 'qoder-existing',
          errors: ['model unavailable'],
        },
      ]) as any,
    );

    for await (const _ of streamChatMessage(mockUser, 'sess-001', 'current question')) {
      // drain
    }

    expect(mockCreateChatQuery).toHaveBeenCalledTimes(1);
    expect(mockCreateChatQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userMessage: 'current question',
        sessionId: 'sess-001',
        qoderSessionId: 'qoder-existing',
        webSearchEnabled: true,
        loadWebSourceRules: mockListEnabledWebSourceRules,
        webSourcesSnapshotPath: expect.stringMatching(/notes\/knowledge-sources\.md$/),
        onEvidence: expect.any(Function),
      }),
    );
    expect(mockGetMessagesBySession).not.toHaveBeenCalled();
  });

  it('passes bound images to the Qoder model request', async () => {
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

  it.each([
    ['Grep', 'local_search', '正在检索本地知识库…'],
    ['Glob', 'local_search', '正在检索本地知识库…'],
    ['Read', 'local_read', '正在阅读相关知识笔记…'],
    ['WebSearch', 'web_search', '本地资料不足，正在搜索已授权网站（1/1）…'],
    ['WebFetch', 'web_fetch', '正在读取网页资料（1/2）…'],
  ])(
    'maps an allowed %s call to %s before its sanitized tool event',
    async (tool, stage, message) => {
      mockGetSession.mockReturnValue({ ...mockSession, webSearchEnabled: true });
      mockCreateChatQuery.mockImplementation((_config, options) => {
        void options.onAllowedToolUse?.({
          toolUseId: 'tool-1',
          name: tool,
          ...(tool.startsWith('Web')
            ? { current: 1, limit: tool === 'WebSearch' ? 1 : 2, sourceName: 'iRacing Support' }
            : {}),
        });
        return createMockSDKStream([
          {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'tool-1',
                  name: tool,
                  input: {
                    query: 'secret user query site:support.iracing.com',
                    url: 'https://support.iracing.com/private?token=secret',
                    file_path: '/data/md-wiki/private.md',
                  },
                },
              ],
            },
          },
          {
            type: 'result',
            subtype: 'success',
            session_id: 'qoder-sess-001',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0,
            duration_ms: 10,
          },
        ]) as any;
      });

      const events = [];
      for await (const event of streamChatMessage(mockUser, 'sess-001', 'secret user query')) {
        events.push(event);
      }

      expect(events[1]).toEqual(expect.objectContaining({ stage: 'understanding' }));
      const statusIndex = events.findIndex((event) => 'stage' in event && event.stage === stage);
      const toolIndex = events.findIndex((event) => 'toolUseId' in event);
      expect(statusIndex).toBeGreaterThan(0);
      expect(statusIndex).toBeLessThan(toolIndex);
      expect(events[statusIndex]).toEqual(
        expect.objectContaining({
          stage,
          message,
          ...(tool.startsWith('Web')
            ? { current: 1, limit: tool === 'WebSearch' ? 1 : 2, sourceName: 'iRacing Support' }
            : {}),
        }),
      );
      expect(events[toolIndex]).toEqual(
        expect.objectContaining({
          name: tool,
          ...(tool.startsWith('Web') ? { inputPreview: 'iRacing Support' } : {}),
        }),
      );
      expect(JSON.stringify(events)).not.toContain('secret user query');
      expect(JSON.stringify(events)).not.toContain('token=secret');
      expect(JSON.stringify(events)).not.toContain('/data/md-wiki/private.md');
    },
  );

  it('emits synthesizing once before the first text delta after a tool call', async () => {
    mockCreateChatQuery.mockImplementation((_config, options) => {
      void options.onAllowedToolUse?.({ toolUseId: 'tool-1', name: 'Grep' });
      return createMockSDKStream([
        {
          type: 'assistant',
          message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Grep', input: {} }] },
        },
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'answer' } },
        },
        {
          type: 'result',
          subtype: 'success',
          session_id: 'qoder-sess-001',
          usage: { input_tokens: 10, output_tokens: 5 },
          total_cost_usd: 0,
          duration_ms: 10,
        },
      ]) as any;
    });

    const events = [];
    for await (const event of streamChatMessage(mockUser, 'sess-001', 'question'))
      events.push(event);
    const synthesizing = events.filter(
      (event) => 'stage' in event && event.stage === 'synthesizing',
    );
    const firstDeltaIndex = events.findIndex((event) => 'seq' in event);

    expect(synthesizing).toHaveLength(1);
    expect(events.indexOf(synthesizing[0]!)).toBe(firstDeltaIndex - 1);
  });

  it('deduplicates the same approved tool id both before and after an SSE flush', async () => {
    mockCreateChatQuery.mockImplementation(
      (_config, options) =>
        (async function* () {
          void options.onAllowedToolUse?.({ toolUseId: 'grep-1', name: 'Grep' });
          void options.onAllowedToolUse?.({ toolUseId: 'grep-1', name: 'Grep' });
          yield { type: 'assistant', message: { content: [] } };
          void options.onAllowedToolUse?.({ toolUseId: 'grep-1', name: 'Grep' });
          yield { type: 'assistant', message: { content: [] } };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'qoder-sess-001',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0,
            duration_ms: 10,
          };
        })() as any,
    );

    const events = [];
    for await (const event of streamChatMessage(mockUser, 'sess-001', 'question'))
      events.push(event);

    expect(events.filter((event) => 'toolUseId' in event)).toHaveLength(1);
    expect(
      events.filter((event) => 'stage' in event && event.stage === 'local_search'),
    ).toHaveLength(1);
  });

  it('does not repeat synthesizing when a complete Web budget notice precedes the first delta', async () => {
    mockGetSession.mockReturnValue({ ...mockSession, webSearchEnabled: true });
    mockCreateChatQuery.mockImplementation((_config, options) => {
      void options.onAllowedToolUse?.({
        toolUseId: 'search-1',
        name: 'WebSearch',
        current: 1,
        limit: 1,
        sourceName: 'Official',
      });
      void options.onAllowedToolUse?.({
        toolUseId: 'fetch-1',
        name: 'WebFetch',
        current: 1,
        limit: 2,
        sourceName: 'Official',
      });
      void options.onAllowedToolUse?.({
        toolUseId: 'fetch-2',
        name: 'WebFetch',
        current: 2,
        limit: 2,
        sourceName: 'Official',
      });
      return createMockSDKStream([
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'answer' } },
        },
        {
          type: 'result',
          subtype: 'success',
          session_id: 'qoder-sess-001',
          usage: { input_tokens: 10, output_tokens: 5 },
          total_cost_usd: 0,
          duration_ms: 10,
        },
      ]) as any;
    });

    const events = [];
    for await (const event of streamChatMessage(mockUser, 'sess-001', 'question'))
      events.push(event);

    expect(events.filter((event) => 'stage' in event && event.stage === 'synthesizing')).toEqual([
      expect.objectContaining({
        message: '联网资料响应较慢，正在使用已获得的内容完成回答…',
      }),
    ]);
  });

  it('emits an allowed Web tool immediately while the SDK next call is still pending', async () => {
    mockGetSession.mockReturnValue({ ...mockSession, webSearchEnabled: true });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inFlight = false;
    let completed = false;
    let nextCalls = 0;
    mockCreateChatQuery.mockImplementation((_config, options) => {
      const iterator = {
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          nextCalls++;
          if (completed) return { done: true as const, value: undefined };
          if (inFlight) throw new Error('concurrent iterator.next()');
          inFlight = true;
          void options.onAllowedToolUse?.({
            toolUseId: 'fetch-pending',
            name: 'WebFetch',
            current: 1,
            limit: 2,
            sourceName: 'Official',
          });
          await gate;
          inFlight = false;
          completed = true;
          return {
            done: false as const,
            value: {
              type: 'result',
              subtype: 'success',
              session_id: 'qoder-sess-001',
              usage: { input_tokens: 10, output_tokens: 5 },
              total_cost_usd: 0,
              duration_ms: 10,
            },
          };
        },
      };
      return iterator as any;
    });

    const generator = streamChatMessage(mockUser, 'sess-001', 'question');
    await generator.next(); // start
    await generator.next(); // understanding
    let progress: IteratorResult<any> | undefined;
    const pendingProgress = generator.next().then((result) => {
      progress = result;
      return result;
    });

    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(progress?.value).toEqual(
        expect.objectContaining({ stage: 'web_fetch', sourceName: 'Official' }),
      );
      expect((await generator.next()).value).toEqual(
        expect.objectContaining({ toolUseId: 'fetch-pending', name: 'WebFetch' }),
      );
      expect(nextCalls).toBe(1);
    } finally {
      release();
      await pendingProgress;
      for await (const _event of generator) {
        // drain
      }
    }
    expect(nextCalls).toBe(2);
  });

  it('emits a slow Web notice at 100 seconds after a real allowed Web call without aborting', async () => {
    vi.useFakeTimers();
    mockGetSession.mockReturnValue({ ...mockSession, webSearchEnabled: true });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockCreateChatQuery.mockImplementation(
      (_config, options) =>
        (async function* () {
          void options.onAllowedToolUse?.({
            toolUseId: 'fetch-1',
            name: 'WebFetch',
            current: 1,
            limit: 2,
            sourceName: 'Official',
          });
          await gate;
          yield {
            type: 'stream_event',
            event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'answer' } },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'qoder-sess-001',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0,
            duration_ms: 100_001,
          };
        })() as any,
    );

    const generator = streamChatMessage(mockUser, 'sess-001', 'question');
    await generator.next(); // start
    await generator.next(); // understanding
    await generator.next(); // web status
    await generator.next(); // sanitized tool
    let slowResult: IteratorResult<any> | undefined;
    const pending = generator.next().then((result) => {
      slowResult = result;
      return result;
    });

    try {
      await vi.advanceTimersByTimeAsync(100_000);
      await Promise.resolve();
      expect(slowResult?.value).toEqual(
        expect.objectContaining({
          stage: 'synthesizing',
          message: '联网资料响应较慢，正在使用已获得的内容完成回答…',
        }),
      );
      expect(mockCreateChatQuery.mock.calls[0]?.[1].abortController.signal.aborted).toBe(false);
      const afterNotice = generator.next();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(mockCreateChatQuery.mock.calls[0]?.[1].abortController.signal.aborted).toBe(true);
      release();
      const firstText = await afterNotice;
      expect(firstText.value).toEqual(expect.objectContaining({ seq: 1, text: 'answer' }));
      const remaining = [];
      for await (const event of generator) remaining.push(event);
      expect(
        remaining.filter((event) => 'stage' in event && event.stage === 'synthesizing'),
      ).toHaveLength(0);
    } finally {
      release();
      await pending;
      await generator.return(undefined);
      vi.useRealTimers();
    }
  });

  it('does not emit the 100-second Web notice when enabled but no approved Web tool ran', async () => {
    vi.useFakeTimers();
    mockGetSession.mockReturnValue({ ...mockSession, webSearchEnabled: true });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockCreateChatQuery.mockReturnValue(
      (async function* () {
        await gate;
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 'qoder-sess-001',
          usage: { input_tokens: 10, output_tokens: 5 },
          total_cost_usd: 0,
          duration_ms: 100_001,
        };
      })() as any,
    );

    const generator = streamChatMessage(mockUser, 'sess-001', 'question');
    await generator.next();
    await generator.next();
    let settled: IteratorResult<any> | undefined;
    const pending = generator.next().then((result) => {
      settled = result;
      return result;
    });
    try {
      await vi.advanceTimersByTimeAsync(100_000);
      await Promise.resolve();
      expect(settled).toBeUndefined();
    } finally {
      release();
      await pending;
      await generator.return(undefined);
      vi.useRealTimers();
    }
  });

  it('does not emit the 100-second Web notice when only an approved local tool ran', async () => {
    vi.useFakeTimers();
    mockGetSession.mockReturnValue({ ...mockSession, webSearchEnabled: true });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockCreateChatQuery.mockImplementation(
      (_config, options) =>
        (async function* () {
          void options.onAllowedToolUse?.({ toolUseId: 'grep-1', name: 'Grep' });
          await gate;
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'qoder-sess-001',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0,
            duration_ms: 100_001,
          };
        })() as any,
    );

    const generator = streamChatMessage(mockUser, 'sess-001', 'question');
    await generator.next();
    await generator.next();
    await generator.next(); // local status
    await generator.next(); // sanitized local tool
    let settled: IteratorResult<any> | undefined;
    const pending = generator.next().then((result) => {
      settled = result;
      return result;
    });
    try {
      await vi.advanceTimersByTimeAsync(100_000);
      await Promise.resolve();
      expect(settled).toBeUndefined();
    } finally {
      release();
      await pending;
      await generator.return(undefined);
      vi.useRealTimers();
    }
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

  it('clears an invalid resumed session and retries the same current message once', async () => {
    mockGetSession.mockReturnValue({ ...mockSession, qoderSessionId: 'expired-session' });
    mockCreateChatQuery
      .mockReturnValueOnce(
        createMockSDKStream([
          {
            type: 'result',
            subtype: 'error_during_execution',
            session_id: 'expired-session',
            errors: ['Resume session not found'],
          },
        ]) as any,
      )
      .mockReturnValueOnce(
        createMockSDKStream([
          {
            type: 'result',
            subtype: 'success',
            session_id: 'fresh-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0,
            duration_ms: 10,
          },
        ]) as any,
      );

    for await (const _ of streamChatMessage(mockUser, 'sess-001', 'current question')) {
      // drain
    }

    expect(mockCreateChatQuery).toHaveBeenCalledTimes(2);
    expect(mockCreateChatQuery.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        userMessage: 'current question',
        qoderSessionId: 'expired-session',
      }),
    );
    expect(mockCreateChatQuery.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ userMessage: 'current question', qoderSessionId: undefined }),
    );
    expect(mockUpdateQoderSessionId).toHaveBeenNthCalledWith(1, 'sess-001', null);
    expect(mockUpdateQoderSessionId).toHaveBeenLastCalledWith('sess-001', 'fresh-session');
  });

  it('does not retry ordinary model, authentication, or timeout failures', async () => {
    mockGetSession.mockReturnValue({ ...mockSession, qoderSessionId: 'active-session' });
    mockCreateChatQuery.mockReturnValue(
      createMockSDKStream([
        {
          type: 'result',
          subtype: 'error_during_execution',
          session_id: 'active-session',
          errors: ['authentication failed while model timed out'],
        },
      ]) as any,
    );

    for await (const _ of streamChatMessage(mockUser, 'sess-001', 'current question')) {
      // drain
    }

    expect(mockCreateChatQuery).toHaveBeenCalledTimes(1);
    expect(mockUpdateQoderSessionId).not.toHaveBeenCalledWith('sess-001', null);
  });

  it.each([
    'authentication failed: session expired',
    'unauthorized credential: resume session invalid',
    'model unavailable: session invalid',
    'session invalid after timeout',
    'resume session expired because request was aborted',
  ])('fails closed instead of recovering for unsafe cross-signal error: %s', async (errorText) => {
    mockGetSession.mockReturnValue({ ...mockSession, qoderSessionId: 'active-session' });
    mockCreateChatQuery.mockReturnValue(
      createMockSDKStream([
        {
          type: 'result',
          subtype: 'error_during_execution',
          session_id: 'active-session',
          errors: [errorText],
        },
      ]) as any,
    );

    for await (const _ of streamChatMessage(mockUser, 'sess-001', 'current question')) {
      // drain
    }

    expect(mockCreateChatQuery).toHaveBeenCalledTimes(1);
    expect(mockUpdateQoderSessionId).not.toHaveBeenCalledWith('sess-001', null);
  });

  it('does not recover a resume error after the request abort signal fires', async () => {
    mockGetSession.mockReturnValue({ ...mockSession, qoderSessionId: 'active-session' });
    mockCreateChatQuery.mockImplementation((_config, options) => {
      options.abortController.abort();
      return createMockSDKStream([
        {
          type: 'result',
          subtype: 'error_during_execution',
          session_id: 'active-session',
          errors: ['resume session expired'],
        },
      ]) as any;
    });

    for await (const _ of streamChatMessage(mockUser, 'sess-001', 'current question')) {
      // drain
    }

    expect(mockCreateChatQuery).toHaveBeenCalledTimes(1);
    expect(mockUpdateQoderSessionId).not.toHaveBeenCalledWith('sess-001', null);
  });

  it.each(['authentication_error', 'model_error', 'request_timeout'])(
    'fails closed when an unsafe marker appears in the SDK subtype: %s',
    async (subtype) => {
      mockGetSession.mockReturnValue({ ...mockSession, qoderSessionId: 'active-session' });
      mockCreateChatQuery.mockReturnValue(
        createMockSDKStream([
          {
            type: 'result',
            subtype,
            session_id: 'active-session',
            errors: ['resume session invalid'],
          },
        ]) as any,
      );

      for await (const _ of streamChatMessage(mockUser, 'sess-001', 'current question')) {
        // drain
      }

      expect(mockCreateChatQuery).toHaveBeenCalledTimes(1);
      expect(mockUpdateQoderSessionId).not.toHaveBeenCalledWith('sess-001', null);
    },
  );

  it('streams the first resumed delta before the Qoder query finishes', async () => {
    mockGetSession.mockReturnValue({ ...mockSession, qoderSessionId: 'active-session' });
    let releaseResult!: () => void;
    const resultGate = new Promise<void>((resolve) => {
      releaseResult = resolve;
    });
    mockCreateChatQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'live delta' },
          },
        };
        await resultGate;
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 'active-session',
          usage: { input_tokens: 10, output_tokens: 5 },
          total_cost_usd: 0,
          duration_ms: 10,
        };
      })() as any,
    );

    const generator = streamChatMessage(mockUser, 'sess-001', 'current question');
    await generator.next(); // start
    await generator.next(); // status
    const firstVisiblePromise = generator.next();
    const race = await Promise.race([
      firstVisiblePromise.then((result) => ({ kind: 'event' as const, result })),
      new Promise<{ kind: 'blocked' }>((resolve) =>
        setTimeout(() => resolve({ kind: 'blocked' }), 10),
      ),
    ]);
    releaseResult();
    const firstVisible = race.kind === 'event' ? race.result : await firstVisiblePromise;
    for await (const _ of generator) {
      // drain after releasing the terminal result
    }

    expect(race.kind).toBe('event');
    expect(firstVisible.value).toEqual(expect.objectContaining({ seq: 1, text: 'live delta' }));
  });

  it('does not retry a resume-like failure after visible output is committed', async () => {
    mockGetSession.mockReturnValue({ ...mockSession, qoderSessionId: 'active-session' });
    mockCreateChatQuery.mockReturnValue(
      createMockSDKStream([
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'visible partial' },
          },
        },
        {
          type: 'result',
          subtype: 'error_during_execution',
          session_id: 'active-session',
          errors: ['resume session expired'],
        },
      ]) as any,
    );

    const events = [];
    for await (const event of streamChatMessage(mockUser, 'sess-001', 'current question')) {
      events.push(event);
    }

    expect(events.filter((event) => 'seq' in event)).toEqual([
      expect.objectContaining({ seq: 1, text: 'visible partial' }),
    ]);
    expect(mockCreateChatQuery).toHaveBeenCalledTimes(1);
    expect(mockUpdateQoderSessionId).not.toHaveBeenCalledWith('sess-001', null);
  });

  it.each(['session_not_found', 'resume-session-not-found', 'resume session not found'])(
    'recovers subtype-only stale resume variants: %s',
    async (subtype) => {
      mockGetSession.mockReturnValue({ ...mockSession, qoderSessionId: 'stale-session' });
      mockCreateChatQuery
        .mockReturnValueOnce(
          createMockSDKStream([{ type: 'result', subtype, session_id: 'stale-session' }]) as any,
        )
        .mockReturnValueOnce(
          createMockSDKStream([
            {
              type: 'result',
              subtype: 'success',
              session_id: 'fresh-session',
              usage: { input_tokens: 10, output_tokens: 5 },
              total_cost_usd: 0,
              duration_ms: 10,
            },
          ]) as any,
        );

      for await (const _ of streamChatMessage(mockUser, 'sess-001', 'current question')) {
        // drain
      }

      expect(mockCreateChatQuery).toHaveBeenCalledTimes(2);
      expect(mockUpdateQoderSessionId).toHaveBeenCalledWith('sess-001', null);
    },
  );

  it('measures fresh retry timing from the second attempt only', async () => {
    mockGetSession.mockReturnValue({ ...mockSession, qoderSessionId: 'stale-session' });
    let now = 0;
    const performanceSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    mockCreateChatQuery
      .mockReturnValueOnce(
        (async function* () {
          now = 100;
          yield {
            type: 'result',
            subtype: 'session_not_found',
            session_id: 'stale-session',
          };
        })() as any,
      )
      .mockReturnValueOnce(
        (async function* () {
          now = 110;
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: 'fresh' },
            },
          };
          now = 130;
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'fresh-session',
            usage: { input_tokens: 10, output_tokens: 5 },
            total_cost_usd: 0,
            duration_ms: 20,
          };
        })() as any,
      );

    const events = [];
    try {
      for await (const event of streamChatMessage(mockUser, 'sess-001', 'current question')) {
        events.push(event);
      }
    } finally {
      performanceSpy.mockRestore();
    }

    expect(events.find((event) => 'inputTokens' in event)).toEqual(
      expect.objectContaining({
        timing: expect.objectContaining({ agentFirstByteMs: 10, agentStreamMs: 30 }),
      }),
    );
  });

  it('discards partial output, evidence, usage, and workflow from a failed resume attempt', async () => {
    mockGetSession.mockReturnValue({ ...mockSession, qoderSessionId: 'expired-session' });
    mockCreateChatQuery.mockImplementation((_config, options) => {
      const attempt = mockCreateChatQuery.mock.calls.length;
      if (attempt === 1) {
        void options.onEvidence?.({
          evidenceId: 'stale-evidence',
          type: 'wiki',
          title: 'Stale evidence',
          wikiPath: 'stale.md',
          excerpt: 'stale',
          retrievedAt: '2026-07-15T00:00:00.000Z',
        });
        return createMockSDKStream([
          {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'stale uncommitted answer' }],
            },
          },
          { type: 'system', subtype: 'api_retry' },
          {
            type: 'result',
            subtype: 'error_during_execution',
            session_id: 'expired-session',
            errors: ['resume session expired'],
          },
        ]) as any;
      }

      void options.onEvidence?.({
        evidenceId: 'fresh-evidence',
        type: 'wiki',
        title: 'Fresh evidence',
        wikiPath: 'fresh.md',
        excerpt: 'fresh',
        retrievedAt: '2026-07-15T00:00:01.000Z',
      });
      return createMockSDKStream([
        {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'fresh answer' },
          },
        },
        {
          type: 'result',
          subtype: 'success',
          session_id: 'fresh-session',
          usage: { input_tokens: 20, output_tokens: 10 },
          total_cost_usd: 0.002,
          duration_ms: 20,
          num_turns: 1,
        },
      ]) as any;
    });

    const events = [];
    for await (const event of streamChatMessage(mockUser, 'sess-001', 'current question')) {
      events.push(event);
    }

    expect(events.filter((event) => 'seq' in event)).toEqual([
      expect.objectContaining({ seq: 1, text: 'fresh answer' }),
    ]);
    expect(events.filter((event) => 'toolUseId' in event)).toEqual([]);
    expect(events.find((event) => 'inputTokens' in event)).toEqual(
      expect.objectContaining({ inputTokens: 20, outputTokens: 10, numTurns: 1 }),
    );
    expect(events.find((event) => 'workflow' in event)).toEqual(
      expect.objectContaining({
        workflow: expect.objectContaining({ toolCallCount: 0, retries: 1 }),
      }),
    );
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'complete', content: 'fresh answer' }),
    );
    expect(mockCreateMessageSource).toHaveBeenCalledTimes(1);
    expect(mockCreateMessageSource).toHaveBeenCalledWith(
      expect.any(String),
      0,
      expect.objectContaining({ title: 'Fresh evidence', wikiPath: 'fresh.md' }),
    );
  });

  it('persists evidence delivered directly by the Qoder query callback', async () => {
    mockCreateChatQuery.mockImplementation((_config, options) => {
      void options.onEvidence?.({
        evidenceId: 'callback-evidence',
        type: 'web',
        title: 'Allowed source',
        url: 'https://example.com/source',
        excerpt: 'verified excerpt',
        retrievedAt: '2026-07-15T00:00:00.000Z',
      });
      return createMockSDKStream([
        {
          type: 'result',
          subtype: 'success',
          session_id: 'fresh-session',
          usage: { input_tokens: 10, output_tokens: 5 },
          total_cost_usd: 0,
          duration_ms: 10,
        },
      ]) as any;
    });

    for await (const _ of streamChatMessage(mockUser, 'sess-001', 'current question')) {
      // drain
    }

    expect(mockCreateMessageSource).toHaveBeenCalledWith(
      expect.any(String),
      0,
      expect.objectContaining({
        sourceType: 'web',
        title: 'Allowed source',
        url: 'https://example.com/source',
      }),
    );
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
      evidence: [
        {
          evidenceId: 'ev-001',
          type: 'wiki',
          title: 'Test Evidence',
          wikiPath: 'test.md',
          excerpt: 'some excerpt',
          retrievedAt: '2026-07-14T00:00:00.000Z',
        },
      ],
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

    expect(events).toContainEqual(
      expect.objectContaining({
        source: expect.objectContaining({ id: 'ev-001', title: 'Test Evidence' }),
      }),
    );
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
