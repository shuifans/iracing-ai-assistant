/**
 * Knowledge module types — service-layer view types for the knowledge pipeline.
 *
 * @module knowledge/types
 */

import type { KnowledgeDraft, KnowledgeSource } from '@/db/schema/knowledge';

// ---------------------------------------------------------------------------
// Extraction & Cleaning
// ---------------------------------------------------------------------------

export interface ExtractionResult {
  text: string;
  charCount: number;
  truncated: boolean;
  warnings: string[];
}

export interface CleaningResult {
  markdown: string;
  frontMatter: FrontMatterData;
  charCount: number;
}

// ---------------------------------------------------------------------------
// Front Matter
// ---------------------------------------------------------------------------

export interface FrontMatterData {
  title: string;
  category: string;
  subcategory: string;
  tags: string[];
  source_name?: string;
  source_url?: string;
  season?: string;
  updated_at?: string;
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export interface PublishResult {
  itemId: string;
  wikiPath: string;
  gitCommitSha: string | null;
  wikiSyncStatus: string;
}

// ---------------------------------------------------------------------------
// Draft review
// ---------------------------------------------------------------------------

export interface DraftReview {
  draft: KnowledgeDraft;
  source: KnowledgeSource;
  extractedText: string | null;
  renderedMarkdown: string;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface CursorPageParams {
  limit?: number;
  cursor?: string;
}

export interface CursorPageResult<T> {
  items: T[];
  nextCursor: string | null;
}
