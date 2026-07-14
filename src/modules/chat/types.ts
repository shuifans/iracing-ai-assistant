/**
 * Chat module types — session summaries, messages, and source data.
 *
 * @module chat/types
 */

import type { MessageSource } from '@/db/schema/chat';

// ---------------------------------------------------------------------------
// Session summary (for list views)
// ---------------------------------------------------------------------------

export interface ChatSessionSummary {
  id: string;
  title: string;
  status: string;
  lastMessageAt: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Message view (enriched with sources and feedback)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: string;
  status: string;
  content: string;
  sources?: MessageSourceData[];
  feedback?: { rating: string; reason?: string } | null;
  createdAt: string;
  /** Client-side pipeline timing (populated from SSE events, not persisted) */
  timing?: PipelineTimingDisplay;
}

export interface PipelineTimingDisplay {
  agentFirstByteMs: number;
  agentStreamMs: number;
  totalMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

// ---------------------------------------------------------------------------
// Source data (extracted from MessageSource row)
// ---------------------------------------------------------------------------

export interface MessageSourceData {
  id: string;
  ordinal: number;
  sourceType: string;
  title: string;
  url?: string | null;
  wikiPath?: string | null;
  excerpt?: string | null;
  season?: string | null;
}

// ---------------------------------------------------------------------------
// Attachment data (for creating attachments)
// ---------------------------------------------------------------------------

export interface AttachmentData {
  kind: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  width?: number | null;
  height?: number | null;
}

// ---------------------------------------------------------------------------
// Source creation data
// ---------------------------------------------------------------------------

export interface SourceData {
  sourceType: 'wiki' | 'web';
  title: string;
  url?: string | null;
  wikiPath?: string | null;
  excerpt?: string | null;
  season?: string | null;
  retrievedAt: string;
}
