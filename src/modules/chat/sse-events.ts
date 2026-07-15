/**
 * SSE event types and serialization for the chat streaming protocol.
 *
 * SPEC §12 — 6 event types: start, delta, source, usage, done, error.
 * All events carry requestId, sessionId, messageId and UTC timestamp.
 *
 * @module chat/sse-events
 */

// ---------------------------------------------------------------------------
// Pipeline timing breakdown
// ---------------------------------------------------------------------------

/** Stage-by-stage timing for a single chat message round. */
export interface PipelineTiming {
  /** Auth middleware (requireAuth + requireActiveUser) */
  authMs: number;
  /** Build agent context (loadMemory, loadProfile, wiki search) */
  loadAgentContextMs: number;
  /** Time from fetch() call to receiving HTTP response headers */
  agentConnectMs: number;
  /** Time from agentConnect start to first SSE event from agent */
  agentFirstByteMs: number;
  /** Duration of streaming the agent response body */
  agentStreamMs: number;
  /** Saving assistant message + sources to DB */
  saveMessageMs: number;
  /** Total wall-clock from request received to stream close */
  totalMs: number;
}

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

/** event: tool — emitted when the agent invokes a tool (tool_use block) */
export interface SSEToolEvent extends SSEEventBase {
  /** Matches the tool_use block id (e.g. toolu_xxx) */
  toolUseId: string;
  /** Tool name: Read/Glob/Grep/WebSearch/WebFetch */
  name: string;
  /** Authorized source display name only; raw tool input is never exposed. */
  inputPreview?: string;
}

/** event: status — live pipeline stage indicator for frontend display */
export interface SSEStatusEvent extends SSEEventBase {
  stage:
    | 'understanding'
    | 'local_search'
    | 'local_read'
    | 'web_search'
    | 'web_fetch'
    | 'synthesizing'
    | 'complete';
  message: string;
  current?: number;
  limit?: number;
  sourceName?: string;
}

/** Per-model usage breakdown (camelCase, from SDK ModelUsage) */
export interface SSEModelUsage {
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
  contextWindow: number;
}

/** event: usage — token / timing telemetry sent at end of stream */
export interface SSEUsageEvent extends SSEEventBase {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  timing?: PipelineTiming;
  // Cache telemetry (from result.usage, NonNullableUsage)
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  cacheHit?: boolean;
  contextUsageRatio?: number;
  // Agent workflow telemetry (from result)
  numTurns?: number;
  durationApiMs?: number;
  stopReason?: string | null;
  serverToolUse?: {
    webFetchRequests: number;
    webSearchRequests: number;
  };
  /** Per-model breakdown keyed by model name */
  modelUsage?: Record<string, SSEModelUsage>;
}

/** Agent workflow summary collected across the stream */
export interface SSEWorkflow {
  /** Total tool_use blocks emitted */
  toolCallCount: number;
  /** Whether context compaction was triggered */
  compacted: boolean;
  /** Compaction metadata if triggered */
  compactMetadata?: {
    preTokens?: number;
    postTokens?: number;
    messagesSummarized?: number;
  };
  /** Number of API retries */
  retries: number;
}

/** event: done — final status; grounding classification */
export interface SSEDoneEvent extends SSEEventBase {
  status: 'complete' | 'interrupted';
  grounding: 'grounded' | 'inferred' | 'insufficient';
  timing?: PipelineTiming;
  workflow?: SSEWorkflow;
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
  | SSEStartEvent
  | SSEDeltaEvent
  | SSESourceEvent
  | SSEToolEvent
  | SSEStatusEvent
  | SSEUsageEvent
  | SSEDoneEvent
  | SSEErrorEvent;

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
