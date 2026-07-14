/**
 * Agent module types — insulates the rest of the app from direct SDK imports.
 *
 * @module agent/types
 */

// ---------------------------------------------------------------------------
// Evidence — returned by wiki-search / web-research sub-agents
// ---------------------------------------------------------------------------

export interface Evidence {
  evidenceId: string;
  type: 'wiki' | 'web';
  title: string;
  url?: string;
  wikiPath?: string;
  excerpt: string;
  /** e.g. "2025S3" — populated when the source is season-specific */
  season?: string;
  /** ISO-8601 timestamp */
  retrievedAt: string;
}

// ---------------------------------------------------------------------------
// Agent configuration (built once from env vars, passed into factory fns)
// ---------------------------------------------------------------------------

export interface AgentConfig {
  /** Absolute path to the read-only md-wiki checkout */
  wikiRoot: string;
  /** Qoder PAT — injected via QODER_PERSONAL_ACCESS_TOKEN */
  pat: string;
  /** Optional model override (e.g. "performance") */
  model?: string;
  /** Max wall-clock time for a chat query (ms) */
  chatTimeoutMs: number;
  /** Max wall-clock time for a cleaning query (ms) */
  cleanTimeoutMs: number;
}

// ---------------------------------------------------------------------------
// Chat query I/O
// ---------------------------------------------------------------------------

export interface ChatQueryOptions {
  /** The raw user message text */
  userMessage: string;
  /** Business-layer session ID (for DB correlation) */
  sessionId?: string;
  /** SDK session ID returned by a previous query — enables `resume` */
  qoderSessionId?: string;
  /** Base64-encoded image attachments (multipart vision) */
  imageAttachments?: Array<{ base64: string; mediaType: string }>;
  /** Caller-owned AbortController for cancellation */
  abortController: AbortController;
}

export interface ChatQueryResult {
  /** SDK session ID — store this to resume later */
  qoderSessionId: string;
  /** Final assistant text (Markdown) */
  content: string;
  /** Structured evidence collected during the query */
  evidence: Evidence[];
  /** Token / cost / timing telemetry */
  usage: {
    inputTokens: number;
    outputTokens: number;
    costMicrousd: number;
    durationMs: number;
    model: string;
  };
  /**
   * Grounding classification:
   * - `grounded`    — answer backed by wiki / web evidence
   * - `inferred`    — reasoning-based answer, no direct citation
   * - `insufficient`— not enough information to answer
   */
  grounding: 'grounded' | 'inferred' | 'insufficient';
}

// ---------------------------------------------------------------------------
// SDK re-exports — other modules MUST import these from here, not from the SDK
// ---------------------------------------------------------------------------

export type { SDKMessage } from '@qoder-ai/qoder-agent-sdk';
