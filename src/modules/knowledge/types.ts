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
// Draft listing (admin 候选稿 tab — cleaned drafts pending review)
// ---------------------------------------------------------------------------

// Joined DB row from listDrafts (draft + best-effort evaluation + source name).
export interface DraftListRow {
  draft: KnowledgeDraft;
  tier: string | null;
  overallScore: number | null;
  evalStatus: string | null;
  sourceOriginalName: string | null;
  sourceUrl: string | null;
}

// Admin-facing list item: draft metadata + parsed category + evaluation tier
// + re-clean count (version - 1).
export interface DraftListItem {
  id: string;
  title: string;
  category: string | null;
  subcategory: string | null;
  sourceName: string | null;
  tier: string | null;
  overallScore: number | null;
  status: string;
  version: number;
  reCleanCount: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Knowledge stats (admin 概览 dashboard)
// ---------------------------------------------------------------------------

export interface CountBucket {
  key: string;
  count: number;
}

export interface KnowledgeStats {
  items: {
    byStatus: CountBucket[];
    byCategory: CountBucket[];
    total: number;
  };
  drafts: {
    byStatus: CountBucket[];
    reviewQueue: number;
    total: number;
  };
  sources: { total: number };
  jobs: { byStatus: CountBucket[] };
  reClean: {
    jobsTotal: number;
    byVersion: { version: number; count: number }[];
  };
  tierDistribution: CountBucket[];
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
