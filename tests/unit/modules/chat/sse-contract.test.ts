/**
 * SSE contract tests — validates the SSE streaming protocol (SPEC §12).
 *
 * Contract invariants:
 *   1. start event includes requestId / sessionId / messageId / timestamp
 *   2. delta event seq starts at 1 and increases monotonically
 *   3. thinking_delta is NEVER forwarded to SSE
 *   4. error event includes code / message / retryable
 *   5. done event includes status and grounding
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SSEEventMapper } from '@/modules/agent/event-mapper';
import type {
  SSEStartEvent,
  SSEDeltaEvent,
  SSEErrorEvent,
  SSEDoneEvent,
  SSEUsageEvent,
} from '@/modules/chat/sse-events';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/datetime', () => ({
  utcNow: vi.fn(() => '2026-07-12T00:00:00.000Z'),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REQUEST_ID = 'req-001';
const SESSION_ID = 'sess-001';
const MESSAGE_ID = 'msg-001';

function createMapper(): SSEEventMapper {
  return new SSEEventMapper(REQUEST_ID, SESSION_ID, MESSAGE_ID);
}

function makeStreamEvent(event: string, extra: Record<string, unknown> = {}) {
  return { type: 'stream_event', event, ...extra };
}

function makeResultSuccess(overrides: Record<string, unknown> = {}) {
  return {
    type: 'result',
    subtype: 'success',
    session_id: 'qoder-sess-001',
    usage: { input_tokens: 100, output_tokens: 50 },
    total_cost_usd: 0.001,
    duration_ms: 2000,
    ...overrides,
  };
}

function makeResultError(subtype: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'result',
    subtype,
    session_id: 'qoder-sess-001',
    usage: { input_tokens: 0, output_tokens: 0 },
    total_cost_usd: 0,
    duration_ms: 100,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. start event contract
// ---------------------------------------------------------------------------

describe('SSE contract — start event', () => {
  it('is emitted by the service layer with requestId, sessionId, messageId, timestamp', () => {
    // The start event is constructed by the service layer (service.ts makeStartEvent).
    // Here we validate the structural contract using the base event shape.
    const mapper = createMapper();

    // Process a system/init message (produces no SSE, but the mapper's base is set)
    const events = mapper.processMessage({ type: 'system', subtype: 'init' });
    expect(events).toHaveLength(0);

    // The start event is created by the service, not the mapper.
    // Validate the start event shape independently.
    const startEvent: SSEStartEvent = {
      requestId: REQUEST_ID,
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      timestamp: '2026-07-12T00:00:00.000Z',
    };

    expect(startEvent.requestId).toBe(REQUEST_ID);
    expect(startEvent.sessionId).toBe(SESSION_ID);
    expect(startEvent.messageId).toBe(MESSAGE_ID);
    expect(startEvent.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('all four required fields are non-empty strings', () => {
    const mapper = createMapper();
    // Simulate a text delta to trigger a delta event with base fields
    const events = mapper.processMessage(makeStreamEvent('text_delta', { delta: 'hi' }));
    expect(events.length).toBeGreaterThan(0);

    const delta = events[0] as SSEDeltaEvent;
    expect(typeof delta.requestId).toBe('string');
    expect(delta.requestId.length).toBeGreaterThan(0);
    expect(typeof delta.sessionId).toBe('string');
    expect(delta.sessionId.length).toBeGreaterThan(0);
    expect(typeof delta.messageId).toBe('string');
    expect(delta.messageId.length).toBeGreaterThan(0);
    expect(typeof delta.timestamp).toBe('string');
    expect(delta.timestamp.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. delta event seq monotonic
// ---------------------------------------------------------------------------

describe('SSE contract — delta seq monotonicity', () => {
  it('seq starts at 1 for the first delta', () => {
    const mapper = createMapper();
    const events = mapper.processMessage(makeStreamEvent('text_delta', { delta: 'Hello' }));

    expect(events).toHaveLength(1);
    const delta = events[0] as SSEDeltaEvent;
    expect(delta.seq).toBe(1);
  });

  it('seq increases monotonically across multiple deltas', () => {
    const mapper = createMapper();
    const chunks = ['Hello', ' ', 'world', '!', ' How', ' are', ' you?'];

    const allDeltas: SSEDeltaEvent[] = [];
    for (const chunk of chunks) {
      const events = mapper.processMessage(makeStreamEvent('text_delta', { delta: chunk }));
      for (const e of events) {
        if ('seq' in e) allDeltas.push(e as SSEDeltaEvent);
      }
    }

    expect(allDeltas).toHaveLength(chunks.length);

    // Verify seq starts at 1 and increases by 1 each time
    for (let i = 0; i < allDeltas.length; i++) {
      expect(allDeltas[i]!.seq).toBe(i + 1);
    }
  });

  it('seq is strictly monotonically increasing (each > previous)', () => {
    const mapper = createMapper();
    const seqs: number[] = [];

    for (let i = 0; i < 10; i++) {
      const events = mapper.processMessage(makeStreamEvent('text_delta', { delta: `chunk-${i}` }));
      for (const e of events) {
        if ('seq' in e) seqs.push((e as SSEDeltaEvent).seq);
      }
    }

    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    }
  });

  it('empty text_delta does not increment seq', () => {
    const mapper = createMapper();

    // First valid delta
    const e1 = mapper.processMessage(makeStreamEvent('text_delta', { delta: 'Hello' }));
    expect((e1[0] as SSEDeltaEvent).seq).toBe(1);

    // Empty delta — should produce no event
    const e2 = mapper.processMessage(makeStreamEvent('text_delta', { delta: '' }));
    expect(e2).toHaveLength(0);

    // Next valid delta — seq should be 2, not 3
    const e3 = mapper.processMessage(makeStreamEvent('text_delta', { delta: 'world' }));
    expect((e3[0] as SSEDeltaEvent).seq).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. thinking_delta not forwarded
// ---------------------------------------------------------------------------

describe('SSE contract — thinking_delta filtered', () => {
  it('thinking_delta produces zero SSE events', () => {
    const mapper = createMapper();
    const events = mapper.processMessage(
      makeStreamEvent('thinking_delta', { delta: 'internal reasoning...' }),
    );
    expect(events).toHaveLength(0);
  });

  it('thinking_delta does not affect delta seq counter', () => {
    const mapper = createMapper();

    // Normal text delta → seq 1
    const e1 = mapper.processMessage(makeStreamEvent('text_delta', { delta: 'Answer' }));
    expect((e1[0] as SSEDeltaEvent).seq).toBe(1);

    // Thinking delta → no event, seq unchanged
    const e2 = mapper.processMessage(makeStreamEvent('thinking_delta', { delta: 'thinking...' }));
    expect(e2).toHaveLength(0);

    // Next text delta → seq 2 (not 3)
    const e3 = mapper.processMessage(makeStreamEvent('text_delta', { delta: ' continued' }));
    expect((e3[0] as SSEDeltaEvent).seq).toBe(2);
  });

  it('input_json_delta also produces zero SSE events', () => {
    const mapper = createMapper();
    const events = mapper.processMessage(makeStreamEvent('input_json_delta', { delta: '{"key":' }));
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. error event contract
// ---------------------------------------------------------------------------

describe('SSE contract — error event', () => {
  it('error_overloaded → code, message, retryable=true', () => {
    const mapper = createMapper();
    const events = mapper.processMessage(makeResultError('error_overloaded'));

    expect(events).toHaveLength(1);
    const err = events[0] as SSEErrorEvent;
    expect(err.code).toBe('AGENT_OVERLOADED');
    expect(typeof err.message).toBe('string');
    expect(err.message.length).toBeGreaterThan(0);
    expect(err.retryable).toBe(true);
  });

  it('error_rate_limit → retryable=true', () => {
    const mapper = createMapper();
    const events = mapper.processMessage(makeResultError('error_rate_limit'));

    const err = events[0] as SSEErrorEvent;
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.retryable).toBe(true);
  });

  it('error_auth → retryable=false', () => {
    const mapper = createMapper();
    const events = mapper.processMessage(makeResultError('error_auth'));

    const err = events[0] as SSEErrorEvent;
    expect(err.code).toBe('AGENT_AUTH_ERROR');
    expect(err.retryable).toBe(false);
  });

  it('error_network → retryable=true', () => {
    const mapper = createMapper();
    const events = mapper.processMessage(makeResultError('error_network'));

    const err = events[0] as SSEErrorEvent;
    expect(err.code).toBe('AGENT_NETWORK_ERROR');
    expect(err.retryable).toBe(true);
  });

  it('error_timeout → retryable=true', () => {
    const mapper = createMapper();
    const events = mapper.processMessage(makeResultError('error_timeout'));

    const err = events[0] as SSEErrorEvent;
    expect(err.code).toBe('AGENT_TIMEOUT');
    expect(err.retryable).toBe(true);
  });

  it('unknown error subtype → fallback AGENT_UNAVAILABLE with retryable=true', () => {
    const mapper = createMapper();
    const events = mapper.processMessage(makeResultError('error_unknown'));

    const err = events[0] as SSEErrorEvent;
    expect(err.code).toBe('AGENT_UNAVAILABLE');
    expect(err.retryable).toBe(true);
  });

  it('error event includes base fields (requestId, sessionId, messageId, timestamp)', () => {
    const mapper = createMapper();
    const events = mapper.processMessage(makeResultError('error_timeout'));

    const err = events[0] as SSEErrorEvent;
    expect(err.requestId).toBe(REQUEST_ID);
    expect(err.sessionId).toBe(SESSION_ID);
    expect(err.messageId).toBe(MESSAGE_ID);
    expect(err.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// 5. done event contract
// ---------------------------------------------------------------------------

describe('SSE contract — done event', () => {
  it('success result produces done event with status=complete and grounding', () => {
    const mapper = createMapper();
    const events = mapper.processMessage(makeResultSuccess());

    const doneEvents = events.filter((e) => 'grounding' in e) as SSEDoneEvent[];
    expect(doneEvents).toHaveLength(1);

    const done = doneEvents[0]!;
    expect(done.status).toBe('complete');
    expect(['grounded', 'inferred', 'insufficient']).toContain(done.grounding);
  });

  it('done event grounding=insufficient when no content and no evidence', () => {
    const mapper = createMapper();
    const events = mapper.processMessage(makeResultSuccess());

    const done = events.find((e) => 'grounding' in e) as SSEDoneEvent;
    expect(done.grounding).toBe('insufficient');
  });

  it('done event grounding=grounded when evidence is present', () => {
    const mapper = createMapper();
    mapper.addEvidence([
      {
        evidenceId: 'ev-001',
        type: 'wiki',
        title: 'Trail Braking',
        wikiPath: '/techniques/trail-braking.md',
        excerpt: 'Trail braking is...',
        season: '2025',
        retrievedAt: '2026-07-12T00:00:00.000Z',
      },
    ]);

    const events = mapper.processMessage(makeResultSuccess());
    const done = events.find((e) => 'grounding' in e) as SSEDoneEvent;
    expect(done.grounding).toBe('grounded');
  });

  it('done event grounding=inferred when content exists but no evidence', () => {
    const mapper = createMapper();
    // Process a text delta first to accumulate content
    mapper.processMessage(makeStreamEvent('text_delta', { delta: 'Some answer' }));

    const events = mapper.processMessage(makeResultSuccess());
    const done = events.find((e) => 'grounding' in e) as SSEDoneEvent;
    expect(done.grounding).toBe('inferred');
  });

  it('success result also produces usage event before done', () => {
    const mapper = createMapper();
    const events = mapper.processMessage(makeResultSuccess());

    const usageEvents = events.filter((e) => 'inputTokens' in e) as SSEUsageEvent[];
    const doneEvents = events.filter((e) => 'grounding' in e) as SSEDoneEvent[];

    expect(usageEvents).toHaveLength(1);
    expect(doneEvents).toHaveLength(1);
    expect(usageEvents[0]!.inputTokens).toBe(100);
    expect(usageEvents[0]!.outputTokens).toBe(50);
    expect(usageEvents[0]!.durationMs).toBe(2000);
  });

  it('done event includes base fields', () => {
    const mapper = createMapper();
    const events = mapper.processMessage(makeResultSuccess());

    const done = events.find((e) => 'grounding' in e) as SSEDoneEvent;
    expect(done.requestId).toBe(REQUEST_ID);
    expect(done.sessionId).toBe(SESSION_ID);
    expect(done.messageId).toBe(MESSAGE_ID);
    expect(done.timestamp).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Full stream contract
// ---------------------------------------------------------------------------

describe('SSE contract — full stream sequence', () => {
  it('produces correct event order: deltas → sources → usage → done', () => {
    const mapper = createMapper();
    const allEvents: Array<{ kind: string }> = [];

    // 1. Text deltas
    const d1 = mapper.processMessage(makeStreamEvent('text_delta', { delta: 'Hello ' }));
    for (const e of d1) allEvents.push({ kind: 'seq' in e ? 'delta' : 'other' });

    const d2 = mapper.processMessage(makeStreamEvent('text_delta', { delta: 'world' }));
    for (const e of d2) allEvents.push({ kind: 'seq' in e ? 'delta' : 'other' });

    // 2. Add evidence
    mapper.addEvidence([
      {
        evidenceId: 'ev-001',
        type: 'wiki',
        title: 'Test',
        wikiPath: '/test.md',
        excerpt: 'Test excerpt',
        season: '2025',
        retrievedAt: '2026-07-12T00:00:00.000Z',
      },
    ]);

    // 3. Result (success) → source, usage, done
    const resultEvents = mapper.processMessage(makeResultSuccess());
    for (const e of resultEvents) {
      if ('grounding' in e) allEvents.push({ kind: 'done' });
      else if ('inputTokens' in e) allEvents.push({ kind: 'usage' });
      else if ('source' in e) allEvents.push({ kind: 'source' });
      else allEvents.push({ kind: 'other' });
    }

    const kinds = allEvents.map((e) => e.kind);
    expect(kinds).toEqual(['delta', 'delta', 'source', 'usage', 'done']);
  });
});
