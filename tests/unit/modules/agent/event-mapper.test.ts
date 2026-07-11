import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock datetime so timestamps are deterministic
// ---------------------------------------------------------------------------

vi.mock('@/lib/datetime', () => ({
  utcNow: vi.fn(() => '2026-07-12T00:00:00.000Z'),
}));

import { SSEEventMapper } from '@/modules/agent/event-mapper';
import type {
  SSEDeltaEvent,
  SSEUsageEvent,
  SSEDoneEvent,
  SSEErrorEvent,
  SSESourceEvent,
} from '@/modules/chat/sse-events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REQ_ID = 'req-001';
const SESS_ID = 'sess-001';
const MSG_ID = 'msg-001';

function makeMapper(): SSEEventMapper {
  return new SSEEventMapper(REQ_ID, SESS_ID, MSG_ID);
}

function isDelta(e: unknown): e is SSEDeltaEvent {
  return typeof e === 'object' && e !== null && 'seq' in e && 'text' in e;
}
function isUsage(e: unknown): e is SSEUsageEvent {
  return typeof e === 'object' && e !== null && 'inputTokens' in e;
}
function isDone(e: unknown): e is SSEDoneEvent {
  return typeof e === 'object' && e !== null && 'status' in e && 'grounding' in e;
}
function isError(e: unknown): e is SSEErrorEvent {
  return typeof e === 'object' && e !== null && 'code' in e && 'retryable' in e;
}
function isSource(e: unknown): e is SSESourceEvent {
  return typeof e === 'object' && e !== null && 'source' in e;
}

// ---------------------------------------------------------------------------
// system/init
// ---------------------------------------------------------------------------

describe('SSEEventMapper — system/init', () => {
  it('returns empty array (log only, no SSE)', () => {
    const mapper = makeMapper();
    const events = mapper.processMessage({
      type: 'system',
      subtype: 'init',
      session_id: 'sdk-sess-xyz',
      sdkVersion: '1.0.0',
    });
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// system/api_retry
// ---------------------------------------------------------------------------

describe('SSEEventMapper — system/api_retry', () => {
  it('returns empty array (metrics only)', () => {
    const mapper = makeMapper();
    const events = mapper.processMessage({
      type: 'system',
      subtype: 'api_retry',
      retryCount: 2,
    });
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// system/permission_denied
// ---------------------------------------------------------------------------

describe('SSEEventMapper — system/permission_denied', () => {
  it('returns empty array (security log only)', () => {
    const mapper = makeMapper();
    const events = mapper.processMessage({
      type: 'system',
      subtype: 'permission_denied',
      tool: 'Bash',
    });
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// stream_event — text_delta
// ---------------------------------------------------------------------------

describe('SSEEventMapper — stream_event text_delta', () => {
  it('produces a SSEDeltaEvent with seq=1 for the first delta', () => {
    const mapper = makeMapper();
    const events = mapper.processMessage({
      type: 'stream_event',
      event: 'text_delta',
      delta: 'Hello',
    });

    expect(events).toHaveLength(1);
    expect(isDelta(events[0])).toBe(true);
    const delta = events[0] as SSEDeltaEvent;
    expect(delta.seq).toBe(1);
    expect(delta.text).toBe('Hello');
    expect(delta.requestId).toBe(REQ_ID);
    expect(delta.sessionId).toBe(SESS_ID);
    expect(delta.messageId).toBe(MSG_ID);
  });

  it('seq increments monotonically across multiple deltas', () => {
    const mapper = makeMapper();

    const e1 = mapper.processMessage({ type: 'stream_event', event: 'text_delta', delta: 'A' });
    const e2 = mapper.processMessage({ type: 'stream_event', event: 'text_delta', delta: 'B' });
    const e3 = mapper.processMessage({ type: 'stream_event', event: 'text_delta', delta: 'C' });

    expect((e1[0] as SSEDeltaEvent).seq).toBe(1);
    expect((e2[0] as SSEDeltaEvent).seq).toBe(2);
    expect((e3[0] as SSEDeltaEvent).seq).toBe(3);
  });

  it('returns empty array when delta text is empty', () => {
    const mapper = makeMapper();
    const events = mapper.processMessage({
      type: 'stream_event',
      event: 'text_delta',
      delta: '',
    });
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// stream_event — thinking_delta (MUST NOT forward)
// ---------------------------------------------------------------------------

describe('SSEEventMapper — stream_event thinking_delta', () => {
  it('returns empty array (thinking must never reach SSE)', () => {
    const mapper = makeMapper();
    const events = mapper.processMessage({
      type: 'stream_event',
      event: 'thinking_delta',
      delta: 'Let me reason about this...',
    });
    expect(events).toEqual([]);
  });

  it('thinking_delta does not affect seq counter', () => {
    const mapper = makeMapper();

    mapper.processMessage({ type: 'stream_event', event: 'text_delta', delta: 'A' });
    mapper.processMessage({ type: 'stream_event', event: 'thinking_delta', delta: 'think...' });
    const events = mapper.processMessage({ type: 'stream_event', event: 'text_delta', delta: 'B' });

    expect((events[0] as SSEDeltaEvent).seq).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// stream_event — input_json_delta (internal, never exposed)
// ---------------------------------------------------------------------------

describe('SSEEventMapper — stream_event input_json_delta', () => {
  it('returns empty array (tool input streaming is internal)', () => {
    const mapper = makeMapper();
    const events = mapper.processMessage({
      type: 'stream_event',
      event: 'input_json_delta',
      delta: '{"query":"trail braking"}',
    });
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// assistant — text block accumulation
// ---------------------------------------------------------------------------

describe('SSEEventMapper — assistant text blocks', () => {
  it('getFullContent returns empty string when no assistant messages processed', () => {
    const mapper = makeMapper();
    expect(mapper.getFullContent()).toBe('');
  });

  it('getFullContent concatenates text from assistant text blocks', () => {
    const mapper = makeMapper();
    mapper.processMessage({
      type: 'assistant',
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world!' },
      ],
    });
    expect(mapper.getFullContent()).toBe('Hello world!');
  });

  it('assistant messages do not produce SSE events directly', () => {
    const mapper = makeMapper();
    const events = mapper.processMessage({
      type: 'assistant',
      content: [{ type: 'text', text: 'Some text' }],
    });
    expect(events).toEqual([]);
  });

  it('tool_use blocks in assistant messages are ignored (audit only)', () => {
    const mapper = makeMapper();
    const events = mapper.processMessage({
      type: 'assistant',
      content: [
        { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/wiki/foo.md' } },
      ],
    });
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// result/success → SSEUsageEvent + SSEDoneEvent
// ---------------------------------------------------------------------------

describe('SSEEventMapper — result/success', () => {
  it('produces usage and done events', () => {
    const mapper = makeMapper();
    // Simulate some content so grounding = 'inferred'
    mapper.processMessage({
      type: 'assistant',
      content: [{ type: 'text', text: 'Answer' }],
    });

    const events = mapper.processMessage({
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 1000, output_tokens: 200 },
      duration_ms: 2500,
    });

    const usageEvents = events.filter(isUsage);
    const doneEvents = events.filter(isDone);
    expect(usageEvents).toHaveLength(1);
    expect(doneEvents).toHaveLength(1);
  });

  it('usage event carries correct token counts', () => {
    const mapper = makeMapper();
    const events = mapper.processMessage({
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 800, output_tokens: 150 },
      duration_ms: 1500,
    });

    const usage = events.find(isUsage)!;
    expect(usage.inputTokens).toBe(800);
    expect(usage.outputTokens).toBe(150);
    expect(usage.durationMs).toBe(1500);
  });

  it('done event has status=complete', () => {
    const mapper = makeMapper();
    mapper.processMessage({
      type: 'assistant',
      content: [{ type: 'text', text: 'Content' }],
    });
    const events = mapper.processMessage({
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 100, output_tokens: 50 },
      duration_ms: 500,
    });

    const done = events.find(isDone)!;
    expect(done.status).toBe('complete');
  });

  it('done event grounding is "grounded" when evidence exists', () => {
    const mapper = makeMapper();
    mapper.addEvidence([
      {
        evidenceId: 'ev-1',
        type: 'wiki',
        title: 'Test',
        excerpt: '...',
        retrievedAt: '2026-07-12T00:00:00.000Z',
      },
    ]);
    const events = mapper.processMessage({
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 100, output_tokens: 50 },
      duration_ms: 500,
    });

    const done = events.find(isDone)!;
    expect(done.grounding).toBe('grounded');
  });

  it('done event grounding is "inferred" when content exists but no evidence', () => {
    const mapper = makeMapper();
    mapper.processMessage({
      type: 'assistant',
      content: [{ type: 'text', text: 'Reasoned answer' }],
    });
    const events = mapper.processMessage({
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 100, output_tokens: 50 },
      duration_ms: 500,
    });

    const done = events.find(isDone)!;
    expect(done.grounding).toBe('inferred');
  });

  it('result with explicit grounding field is respected', () => {
    const mapper = makeMapper();
    const events = mapper.processMessage({
      type: 'result',
      subtype: 'success',
      grounding: 'insufficient',
      usage: { input_tokens: 50, output_tokens: 10 },
      duration_ms: 300,
    });

    const done = events.find(isDone)!;
    expect(done.grounding).toBe('insufficient');
  });

  it('result/success with evidence emits source events before usage/done', () => {
    const mapper = makeMapper();
    mapper.addEvidence([
      {
        evidenceId: 'ev-1',
        type: 'wiki',
        title: 'Trail Braking',
        wikiPath: '/techniques/trail-braking.md',
        excerpt: '...',
        retrievedAt: '2026-07-12T00:00:00.000Z',
      },
    ]);
    const events = mapper.processMessage({
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 100, output_tokens: 50 },
      duration_ms: 500,
    });

    const sources = events.filter(isSource);
    expect(sources).toHaveLength(1);
    const src = sources[0] as SSESourceEvent;
    expect(src.source.id).toBe('ev-1');
    expect(src.source.ordinal).toBe(1);
    expect(src.source.type).toBe('wiki');
    expect(src.source.wikiPath).toBe('/techniques/trail-braking.md');

    // source events come before usage/done
    const usageIdx = events.findIndex(isUsage);
    const doneIdx = events.findIndex(isDone);
    expect(0).toBeLessThan(usageIdx);
    expect(usageIdx).toBeLessThan(doneIdx);
  });
});

// ---------------------------------------------------------------------------
// result/error_* → SSEErrorEvent
// ---------------------------------------------------------------------------

describe('SSEEventMapper — result/error_*', () => {
  it('error_overloaded maps to AGENT_OVERLOADED with retryable=true', () => {
    const mapper = makeMapper();
    const events = mapper.processMessage({
      type: 'result',
      subtype: 'error_overloaded',
    });

    expect(events).toHaveLength(1);
    const err = events[0] as SSEErrorEvent;
    expect(err.code).toBe('AGENT_OVERLOADED');
    expect(err.retryable).toBe(true);
  });

  it('error_rate_limit maps to RATE_LIMITED with retryable=true', () => {
    const mapper = makeMapper();
    const events = mapper.processMessage({
      type: 'result',
      subtype: 'error_rate_limit',
    });

    const err = events[0] as SSEErrorEvent;
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.retryable).toBe(true);
  });

  it('error_auth maps to AGENT_AUTH_ERROR with retryable=false', () => {
    const mapper = makeMapper();
    const events = mapper.processMessage({
      type: 'result',
      subtype: 'error_auth',
    });

    const err = events[0] as SSEErrorEvent;
    expect(err.code).toBe('AGENT_AUTH_ERROR');
    expect(err.retryable).toBe(false);
  });

  it('unknown error subtype falls back to AGENT_UNAVAILABLE', () => {
    const mapper = makeMapper();
    const events = mapper.processMessage({
      type: 'result',
      subtype: 'error_unknown_thing',
    });

    const err = events[0] as SSEErrorEvent;
    expect(err.code).toBe('AGENT_UNAVAILABLE');
    expect(err.retryable).toBe(true);
  });

  it('error events carry base fields (requestId, sessionId, messageId)', () => {
    const mapper = makeMapper();
    const events = mapper.processMessage({
      type: 'result',
      subtype: 'error_network',
    });

    const err = events[0] as SSEErrorEvent;
    expect(err.requestId).toBe(REQ_ID);
    expect(err.sessionId).toBe(SESS_ID);
    expect(err.messageId).toBe(MSG_ID);
  });
});

// ---------------------------------------------------------------------------
// addEvidence / getReferencedEvidence
// ---------------------------------------------------------------------------

describe('SSEEventMapper — evidence', () => {
  it('getReferencedEvidence returns empty array initially', () => {
    const mapper = makeMapper();
    expect(mapper.getReferencedEvidence()).toEqual([]);
  });

  it('addEvidence stores items retrievable via getReferencedEvidence', () => {
    const mapper = makeMapper();
    const ev = {
      evidenceId: 'ev-1',
      type: 'wiki' as const,
      title: 'Test',
      excerpt: '...',
      retrievedAt: '2026-07-12T00:00:00.000Z',
    };
    mapper.addEvidence([ev]);
    expect(mapper.getReferencedEvidence()).toHaveLength(1);
    expect(mapper.getReferencedEvidence()[0]!.evidenceId).toBe('ev-1');
  });

  it('addEvidence de-duplicates by evidenceId', () => {
    const mapper = makeMapper();
    const ev = {
      evidenceId: 'ev-1',
      type: 'wiki' as const,
      title: 'Test',
      excerpt: '...',
      retrievedAt: '2026-07-12T00:00:00.000Z',
    };
    mapper.addEvidence([ev]);
    mapper.addEvidence([ev]);
    expect(mapper.getReferencedEvidence()).toHaveLength(1);
  });

  it('getReferencedEvidence returns a copy (mutations do not affect internal state)', () => {
    const mapper = makeMapper();
    mapper.addEvidence([
      {
        evidenceId: 'ev-1',
        type: 'wiki',
        title: 'T',
        excerpt: '',
        retrievedAt: '',
      },
    ]);
    const copy = mapper.getReferencedEvidence();
    copy.pop();
    expect(mapper.getReferencedEvidence()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Unknown / unrecognised message types
// ---------------------------------------------------------------------------

describe('SSEEventMapper — unknown messages', () => {
  it('returns empty array for null/undefined messages', () => {
    const mapper = makeMapper();
    expect(mapper.processMessage(null)).toEqual([]);
    expect(mapper.processMessage(undefined)).toEqual([]);
  });

  it('returns empty array for unknown type', () => {
    const mapper = makeMapper();
    expect(mapper.processMessage({ type: 'unknown_type' })).toEqual([]);
  });
});
