/**
 * Agent module types — insulates the rest of the app from direct SDK imports.
 *
 * @module agent/types
 */

import { z } from 'zod';
import type { WebSourceRule } from '@/modules/web-sources/types';

// ---------------------------------------------------------------------------
// Evidence — captured from direct Read / WebFetch tool results
// ---------------------------------------------------------------------------

export const MAX_EVIDENCE_ITEMS = 10;
export const MAX_EVIDENCE_OUTPUT_BYTES = 64 * 1024;

/** Single evidence contract shared by agent hooks and stream consumers. */
export const EvidenceSchema = z
  .object({
    evidenceId: z.string().trim().min(1).max(128),
    type: z.enum(['wiki', 'web']),
    title: z.string().trim().min(1).max(300),
    url: z.string().url().max(2048).optional(),
    wikiPath: z.string().trim().min(1).max(1024).optional(),
    excerpt: z.string().max(600),
    /** e.g. "2025S3" — populated when the source is season-specific */
    season: z.string().trim().min(1).max(64).optional(),
    /** ISO-8601 timestamp */
    retrievedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((evidence, ctx) => {
    if (evidence.type === 'wiki' && !evidence.wikiPath) {
      ctx.addIssue({
        code: 'custom',
        path: ['wikiPath'],
        message: 'Wiki evidence requires wikiPath',
      });
    }
    if (evidence.type === 'web' && !evidence.url) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'Web evidence requires url',
      });
    }
  });

export const EvidenceEnvelopeSchema = z
  .object({
    evidence: z.array(EvidenceSchema).max(MAX_EVIDENCE_ITEMS),
  })
  .strict();

export type Evidence = z.infer<typeof EvidenceSchema>;
export type EvidenceEnvelope = z.infer<typeof EvidenceEnvelopeSchema>;

/** Parse the exact JSON envelope while bounding untrusted hook output size. */
export function parseEvidenceEnvelope(value: unknown): EvidenceEnvelope | null {
  let parsed = value;
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_EVIDENCE_OUTPUT_BYTES) return null;
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }

  const result = EvidenceEnvelopeSchema.safeParse(parsed);
  return result.success ? result.data : null;
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
  /** Query snapshot of the business session's Web-search capability. */
  webSearchEnabled?: boolean;
  /** Loads the currently enabled runtime authorization rules for each Web call. */
  loadWebSourceRules?: () => WebSourceRule[];
  /** The one non-Wiki file the agent may Read before using Web tools. */
  webSourcesSnapshotPath?: string;
  /** Receives evidence captured from direct Read and WebFetch results. */
  onEvidence?: (evidence: Evidence) => void | Promise<void>;
  /** Receives only tool calls that passed the query-local permission hook. */
  onAllowedToolUse?: (tool: AllowedToolUse) => void | Promise<void>;
}

export interface AllowedToolUse {
  toolUseId: string;
  name: string;
  current?: number;
  limit?: number;
  /** Administrator-maintained display name; never a raw query or URL. */
  sourceName?: string;
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
