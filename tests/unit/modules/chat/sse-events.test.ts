import { describe, it, expect } from 'vitest';
import {
  formatSSEEvent,
  SSE_HEADERS,
  type SSEStartEvent,
  type SSEDeltaEvent,
  type SSESourceEvent,
  type SSEUsageEvent,
  type SSEDoneEvent,
  type SSEErrorEvent,
} from '@/modules/chat/sse-events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = {
  requestId: 'req-001',
  sessionId: 'sess-001',
  messageId: 'msg-001',
  timestamp: '2026-07-12T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// formatSSEEvent
// ---------------------------------------------------------------------------

describe('formatSSEEvent', () => {
  it('outputs correct SSE wire format (event: xxx\\ndata: {...}\\n\\n)', () => {
    const start: SSEStartEvent = { ...BASE };
    const output = formatSSEEvent('start', start);
    expect(output).toBe(
      `event: start\ndata: ${JSON.stringify(start)}\n\n`,
    );
  });

  it('serializes a delta event with seq field', () => {
    const delta: SSEDeltaEvent = { ...BASE, seq: 1, text: 'Hello' };
    const output = formatSSEEvent('delta', delta);
    expect(output).toContain('event: delta');
    expect(output).toContain('"seq":1');
    expect(output).toContain('"text":"Hello"');
    expect(output.endsWith('\n\n')).toBe(true);
  });

  it('serializes a source event with nested source object', () => {
    const source: SSESourceEvent = {
      ...BASE,
      source: {
        id: 'ev-001',
        ordinal: 1,
        type: 'wiki',
        title: 'Trail Braking',
        wikiPath: '/techniques/trail-braking.md',
      },
    };
    const output = formatSSEEvent('source', source);
    expect(output).toContain('event: source');
    expect(output).toContain('"id":"ev-001"');
    expect(output).toContain('"ordinal":1');
    expect(output).toContain('"wikiPath"');
  });

  it('serializes a usage event with token counts', () => {
    const usage: SSEUsageEvent = {
      ...BASE,
      inputTokens: 1200,
      outputTokens: 450,
      durationMs: 3200,
    };
    const output = formatSSEEvent('usage', usage);
    expect(output).toContain('"inputTokens":1200');
    expect(output).toContain('"outputTokens":450');
    expect(output).toContain('"durationMs":3200');
  });

  it('serializes a done event with status and grounding', () => {
    const done: SSEDoneEvent = {
      ...BASE,
      status: 'complete',
      grounding: 'grounded',
    };
    const output = formatSSEEvent('done', done);
    expect(output).toContain('"status":"complete"');
    expect(output).toContain('"grounding":"grounded"');
  });

  it('serializes an error event with retryable field', () => {
    const error: SSEErrorEvent = {
      ...BASE,
      code: 'AGENT_UNAVAILABLE',
      message: 'AI 服务暂时不可用，请稍后重试',
      retryable: true,
    };
    const output = formatSSEEvent('error', error);
    expect(output).toContain('event: error');
    expect(output).toContain('"code":"AGENT_UNAVAILABLE"');
    expect(output).toContain('"retryable":true');
  });

  it('error event with retryable=false serializes correctly', () => {
    const error: SSEErrorEvent = {
      ...BASE,
      code: 'AGENT_AUTH_ERROR',
      message: '认证失败',
      retryable: false,
    };
    const output = formatSSEEvent('error', error);
    expect(output).toContain('"retryable":false');
  });
});

// ---------------------------------------------------------------------------
// SSE_HEADERS
// ---------------------------------------------------------------------------

describe('SSE_HEADERS', () => {
  it('contains correct Content-Type', () => {
    expect(SSE_HEADERS['Content-Type']).toBe('text/event-stream; charset=utf-8');
  });

  it('contains Cache-Control: no-cache, no-transform', () => {
    expect(SSE_HEADERS['Cache-Control']).toBe('no-cache, no-transform');
  });

  it('contains X-Accel-Buffering: no', () => {
    expect(SSE_HEADERS['X-Accel-Buffering']).toBe('no');
  });

  it('has exactly 3 headers', () => {
    expect(Object.keys(SSE_HEADERS)).toHaveLength(3);
  });
});
