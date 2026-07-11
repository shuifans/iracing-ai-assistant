/**
 * SDK → SSE event mapper.
 *
 * Translates the raw SDK AsyncGenerator messages (SDKMessage) into
 * business-layer SSE events that are safe to stream to the client.
 *
 * SPEC §10.4 — mapping table:
 *   system/init         → log only, no SSE
 *   stream_event        → delta (text_delta only) or ignore (thinking/input_json)
 *   assistant text      → accumulate for getFullContent()
 *   assistant tool_use  → audit only
 *   system/api_retry    → log retry metrics
 *   system/permission_  → log security event
 *   result/success      → SSEUsageEvent + SSEDoneEvent
 *   result/error_*      → SSEErrorEvent
 *
 * @module agent/event-mapper
 */

import { utcNow } from '@/lib/datetime';
import type { Evidence } from './types';
import type {
  SSEEvent,
  SSEEventBase,
  SSEDeltaEvent,
  SSEUsageEvent,
  SSEDoneEvent,
  SSEErrorEvent,
  SSESourceEvent,
} from '@/modules/chat/sse-events';

// ---------------------------------------------------------------------------
// Error code mapping (SPEC §12 — error codes)
// ---------------------------------------------------------------------------

/** Maps SDK error sub-types to business error codes and retryable flags. */
const ERROR_MAP: Record<
  string,
  { code: string; message: string; retryable: boolean }
> = {
  error_overloaded: {
    code: 'AGENT_OVERLOADED',
    message: 'AI 服务当前负载较高，请稍后重试',
    retryable: true,
  },
  error_rate_limit: {
    code: 'RATE_LIMITED',
    message: '请求过于频繁，请稍后重试',
    retryable: true,
  },
  error_auth: {
    code: 'AGENT_AUTH_ERROR',
    message: 'AI 服务认证失败，请联系管理员',
    retryable: false,
  },
  error_network: {
    code: 'AGENT_NETWORK_ERROR',
    message: 'AI 服务网络连接失败，请稍后重试',
    retryable: true,
  },
  error_timeout: {
    code: 'AGENT_TIMEOUT',
    message: 'AI 响应超时，请稍后重试',
    retryable: true,
  },
};

/** Fallback for unknown error sub-types. */
const DEFAULT_ERROR = {
  code: 'AGENT_UNAVAILABLE',
  message: 'AI 服务暂时不可用，请稍后重试',
  retryable: true,
};

// ---------------------------------------------------------------------------
// Mapper class
// ---------------------------------------------------------------------------

/**
 * Processes a stream of SDK messages and produces SSE events.
 *
 * Usage:
 * ```ts
 * const mapper = new SSEEventMapper(requestId, sessionId, messageId);
 * for await (const msg of sdkGenerator) {
 *   const events = mapper.processMessage(msg);
 *   for (const evt of events) { writeSSE(evt); }
 * }
 * ```
 */
export class SSEEventMapper {
  /** Monotonically increasing seq counter — starts at 1 (SPEC §12). */
  private seq = 0;

  /** Immutable base fields attached to every emitted event. */
  private readonly base: SSEEventBase;

  /** Accumulated full assistant text (from assistant text content blocks). */
  private readonly contentParts: string[] = [];

  /** Evidence collected via PostToolUse hook outputs. */
  private readonly evidence: Evidence[] = [];

  /** Ordinal counter for source events. */
  private sourceOrdinal = 0;

  constructor(requestId: string, sessionId: string, messageId: string) {
    this.base = { requestId, sessionId, messageId, timestamp: utcNow() };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Process a single SDK message and return zero or more SSE events.
   *
   * One SDK message may produce multiple SSE events (e.g. result/success
   * produces both a usage and a done event).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processMessage(sdkMessage: any): SSEEvent[] {
    const type: string = sdkMessage?.type ?? '';

    switch (type) {
      case 'system':
        return this.processSystem(sdkMessage);

      case 'stream_event':
        return this.processStreamEvent(sdkMessage);

      case 'assistant':
        return this.processAssistant(sdkMessage);

      case 'result':
        return this.processResult(sdkMessage);

      default:
        return [];
    }
  }

  /**
   * Returns the full assistant text accumulated from all processed messages.
   * Used after the stream completes to persist the final message content.
   */
  getFullContent(): string {
    return this.contentParts.join('');
  }

  /**
   * Returns evidence objects collected from PostToolUse hook outputs.
   * Used to persist structured citations alongside the chat message.
   */
  getReferencedEvidence(): Evidence[] {
    return [...this.evidence];
  }

  // ---------------------------------------------------------------------------
  // Private — system messages
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private processSystem(msg: any): SSEEvent[] {
    const subtype: string = msg?.subtype ?? '';

    switch (subtype) {
      case 'init':
        // SPEC §10.4 — log session_id and SDK version; no SSE event
        return [];

      case 'api_retry':
        // SPEC §10.4 — write retry metrics; no SSE event for now
        return [];

      case 'permission_denied':
        // SPEC §10.4 — record security event; no SSE event
        return [];

      default:
        return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Private — stream_event (partial tokens)
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private processStreamEvent(msg: any): SSEEvent[] {
    const event: string = msg?.event ?? '';

    switch (event) {
      case 'text_delta': {
        const text: string = msg?.delta ?? msg?.text ?? '';
        if (!text) return [];

        this.seq += 1;
        const delta: SSEDeltaEvent = {
          ...this.base,
          timestamp: utcNow(),
          seq: this.seq,
          text,
        };
        return [delta];
      }

      case 'thinking_delta':
        // SPEC §12 — thinking_delta MUST NOT be forwarded to SSE
        return [];

      case 'input_json_delta':
        // Tool input streaming — internal only, never exposed
        return [];

      default:
        return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Private — assistant (complete message blocks)
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private processAssistant(msg: any): SSEEvent[] {
    const content: unknown[] = msg?.content ?? [];

    for (const block of content) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = block as any;
      const blockType: string = b?.type ?? '';

      if (blockType === 'text') {
        // Accumulate full text for later persistence
        const text: string = b?.text ?? '';
        if (text) this.contentParts.push(text);
      }

      if (blockType === 'tool_use') {
        // SPEC §10.4 — tool_use blocks are audit-only; never exposed via SSE.
        // Evidence may appear in the tool_result via PostToolUse hook, which
        // is captured separately when the result message arrives.
      }
    }

    // Assistant messages do not directly produce SSE events here;
    // deltas are already streamed via stream_event.
    return [];
  }

  // ---------------------------------------------------------------------------
  // Private — result (terminal)
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private processResult(msg: any): SSEEvent[] {
    const subtype: string = msg?.subtype ?? '';

    if (subtype === 'success') {
      return this.buildSuccessEvents(msg);
    }

    // All error sub-types: error_overloaded, error_rate_limit, error_auth, etc.
    if (subtype.startsWith('error')) {
      return this.buildErrorEvent(msg);
    }

    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildSuccessEvents(msg: any): SSEEvent[] {
    const usage: SSEUsageEvent = {
      ...this.base,
      timestamp: utcNow(),
      inputTokens: msg?.usage?.input_tokens ?? msg?.inputTokens ?? 0,
      outputTokens: msg?.usage?.output_tokens ?? msg?.outputTokens ?? 0,
      durationMs: msg?.duration_ms ?? msg?.durationMs ?? 0,
    };

    const grounding = this.resolveGrounding(msg);
    const done: SSEDoneEvent = {
      ...this.base,
      timestamp: utcNow(),
      status: 'complete',
      grounding,
    };

    // Emit source events for collected evidence before usage/done
    const sourceEvents = this.buildSourceEvents();

    return [...sourceEvents, usage, done];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildErrorEvent(msg: any): SSEEvent[] {
    const subtype: string = msg?.subtype ?? '';
    const mapped = ERROR_MAP[subtype] ?? DEFAULT_ERROR;

    const error: SSEErrorEvent = {
      ...this.base,
      timestamp: utcNow(),
      code: mapped.code,
      message: mapped.message,
      retryable: mapped.retryable,
    };

    return [error];
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Build SSESourceEvent for each piece of collected evidence. */
  private buildSourceEvents(): SSEEvent[] {
    return this.evidence.map((ev) => {
      this.sourceOrdinal += 1;
      const source: SSESourceEvent = {
        ...this.base,
        timestamp: utcNow(),
        source: {
          id: ev.evidenceId,
          ordinal: this.sourceOrdinal,
          type: ev.type,
          title: ev.title,
          ...(ev.wikiPath ? { wikiPath: ev.wikiPath } : {}),
          ...(ev.url ? { url: ev.url } : {}),
        },
      };
      return source;
    });
  }

  /**
   * Determine grounding classification from the result message.
   * Falls back to 'inferred' when evidence is present but not conclusive,
   * or 'insufficient' when there is no content at all.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resolveGrounding(msg: any): 'grounded' | 'inferred' | 'insufficient' {
    // If the SDK result carries an explicit grounding field, use it
    const explicit: string | undefined = msg?.grounding;
    if (explicit === 'grounded' || explicit === 'inferred' || explicit === 'insufficient') {
      return explicit;
    }

    // Heuristic: if we have evidence, it's grounded
    if (this.evidence.length > 0) return 'grounded';

    // If we have content but no evidence, it's inferred
    if (this.contentParts.length > 0) return 'inferred';

    return 'insufficient';
  }

  /**
   * Ingest evidence collected from PostToolUse hook outputs.
   * Called by the stream consumer when it encounters a hook result
   * containing structured evidence JSON.
   */
  addEvidence(items: Evidence[]): void {
    for (const item of items) {
      // De-duplicate by evidenceId
      if (!this.evidence.some((e) => e.evidenceId === item.evidenceId)) {
        this.evidence.push(item);
      }
    }
  }
}
