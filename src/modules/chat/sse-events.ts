/**
 * SSE event types and serialization for the chat streaming protocol.
 *
 * SPEC §12 — 6 event types: start, delta, source, usage, done, error.
 * All events carry requestId, sessionId, messageId and UTC timestamp.
 *
 * @module chat/sse-events
 */

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

export interface SSEEventBase {
  requestId: string;
  sessionId: string;
  messageId: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

/** event: start — emitted once when the stream begins */
export interface SSEStartEvent extends SSEEventBase {
  /* event: 'start' */
}

/** event: delta — incremental text chunk; seq is 1-based and monotonic */
export interface SSEDeltaEvent extends SSEEventBase {
  seq: number;
  text: string;
}

/** event: source — evidence citation surfaced mid-stream */
export interface SSESourceEvent extends SSEEventBase {
  source: {
    id: string;
    ordinal: number;
    type: string;
    title: string;
    wikiPath?: string;
    url?: string;
  };
}

/** event: usage — token / timing telemetry sent at end of stream */
export interface SSEUsageEvent extends SSEEventBase {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

/** event: done — final status; grounding classification */
export interface SSEDoneEvent extends SSEEventBase {
  status: 'complete' | 'interrupted';
  grounding: 'grounded' | 'inferred' | 'insufficient';
}

/** event: error — terminal error; no `done` is sent after this */
export interface SSEErrorEvent extends SSEEventBase {
  code: string;
  message: string;
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type SSEEvent =
  SSEStartEvent | SSEDeltaEvent | SSESourceEvent | SSEUsageEvent | SSEDoneEvent | SSEErrorEvent;

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize an SSE event into the wire format expected by EventSource:
 *
 * ```
 * event: <eventType>
 * data: <JSON>
 *
 * ```
 */
export function formatSSEEvent(eventType: string, data: SSEEvent): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ---------------------------------------------------------------------------
// Response headers
// ---------------------------------------------------------------------------

/** HTTP headers required for an SSE response (SPEC §12). */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
} as const;
